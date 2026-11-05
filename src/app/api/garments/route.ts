import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';
import { normalizeGarmentImage } from '@/lib/images/normalize-garment-image';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
async function edgeErrorMessage(error: { context?: unknown }) {
  if (error.context instanceof Response) {
    try { const payload = await error.context.clone().json(); if (typeof payload.error === 'string') return payload.error; } catch { /* use deployment hint below */ }
  }
  return 'La función remove-background no está desplegada o no responde. Se guardará la imagen original.';
}

function unavailable() {
  return NextResponse.json({ error: 'Configura Supabase para guardar prendas en tu Closet.' }, { status: 503 });
}

export async function GET() {
  if (!hasSupabaseConfig()) return unavailable();
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Inicia sesión para consultar tu Closet.' }, { status: 401 });

  const { data: garments, error } = await supabase
    .from('garments')
    .select('id,name,category,subcategory,color,original_path,processed_path,model_3d_path,processing_status,is_favorite,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'No se pudieron cargar las prendas.' }, { status: 500 });

  const items = await Promise.all((garments ?? []).map(async garment => {
    const path = garment.processed_path || garment.original_path;
    if (!path) return { ...garment, image_url: null };
    const { data } = await supabase.storage.from('garments').createSignedUrl(path, 30 * 60);
    return { ...garment, image_url: data?.signedUrl ?? null };
  }));
  return NextResponse.json({ garments: items });
}

export async function POST(request: Request) {
  if (!hasSupabaseConfig()) return unavailable();
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_FILE_SIZE + 128 * 1024) {
    return NextResponse.json({ error: 'La solicitud supera el límite permitido de 10 MB.' }, { status: 413 });
  }
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Inicia sesión para guardar una prenda.' }, { status: 401 });

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: 'No se pudo leer la imagen.' }, { status: 400 }); }

  const candidate = form.get('image');
  const name = String(form.get('name') || '').trim();
  const category = String(form.get('category') || '').trim();
  const subcategory = String(form.get('subcategory') || '').trim();
  const color = String(form.get('color') || '').trim();
  const allowPaidProcessing = form.get('allow_paid_processing') === 'yes';
  if (!(candidate instanceof File) || candidate.size <= 0 || candidate.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'Elige una imagen JPG, PNG o WEBP de hasta 10 MB.' }, { status: 400 });
  }
  if (!name || name.length > 100 || !category || category.length > 80 || subcategory.length > 80 || color.length > 60) {
    return NextResponse.json({ error: 'Revisa el nombre, la categoría y los atributos de la prenda.' }, { status: 400 });
  }
  let file: File;
  try {
    file = await normalizeGarmentImage(candidate);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'La imagen no es válida.' },
      { status: 400 },
    );
  }

  let processedBytes: Uint8Array | null = null;
  let processingJobId: string | null = null;
  let processingWarning: string | null = null;
  if (allowPaidProcessing) {
    processingJobId = crypto.randomUUID();
    const providerForm = new FormData();
    providerForm.set('image', file, file.name || 'garment');
    providerForm.set('allow_paid_processing', 'yes');
    providerForm.set('processing_job_id', processingJobId);
    const { data, error: functionError } = await supabase.functions.invoke('remove-background', { body: providerForm });
    if (functionError) processingWarning = await edgeErrorMessage(functionError);
    else if (!(data instanceof Blob)) processingWarning = 'Clipdrop devolvió una respuesta no válida. Se guardará la imagen original.';
    else {
      const result = new Uint8Array(await data.arrayBuffer());
      const validPng = data.type.includes('image/png') && result.length >= 26 && [137,80,78,71,13,10,26,10].every((byte,index) => result[index] === byte) && [4,6].includes(result[25]) && result.length <= MAX_FILE_SIZE;
      if (validPng) processedBytes = result;
      else processingWarning = 'El resultado de Clipdrop no pasó la validación. Se guardará la imagen original.';
    }
    if (processingWarning) await supabase.from('processing_jobs').update({ status: 'failed', safe_error: processingWarning.slice(0,180) }).eq('id', processingJobId).eq('user_id', user.id);
  }

  const baseName = crypto.randomUUID();
  const objectPath = `${user.id}/${baseName}.${MIME_EXTENSIONS[file.type]}`;
  const processedPath = processedBytes ? `${user.id}/${baseName}-processed.png` : null;
  const { error: uploadError } = await supabase.storage.from('garments').upload(objectPath, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadError) {
    if (processingJobId && processedBytes) await supabase.from('processing_jobs').update({ status: 'failed', safe_error: 'No se pudo guardar el archivo.' }).eq('id', processingJobId).eq('user_id', user.id);
    return NextResponse.json({ error: 'No se pudo guardar la imagen privada. Inténtalo de nuevo.' }, { status: 502 });
  }
  if (processedBytes && processedPath) {
    const { error: processedUploadError } = await supabase.storage.from('garments').upload(processedPath, processedBytes, {
      contentType: 'image/png', cacheControl: '3600', upsert: false,
    });
    if (processedUploadError) {
      await supabase.storage.from('garments').remove([objectPath]);
      if (processingJobId && processedBytes) await supabase.from('processing_jobs').update({ status: 'failed', safe_error: 'No se pudo guardar el resultado.' }).eq('id', processingJobId).eq('user_id', user.id);
      return NextResponse.json({ error: 'No se pudo guardar el resultado procesado.' }, { status: 502 });
    }
  }

  const { data: garment, error: insertError } = await supabase.from('garments').insert({
    user_id: user.id,
    name,
    category,
    subcategory: subcategory || null,
    color: color || null,
    original_path: objectPath,
    processed_path: processedPath,
    processing_status: processedPath ? 'ready' : 'pending',
  }).select('id,name,category,subcategory,color,original_path,processed_path,processing_status,is_favorite,created_at').single();

  if (insertError || !garment) {
    await supabase.storage.from('garments').remove([objectPath, ...(processedPath ? [processedPath] : [])]);
    if (processingJobId && processedBytes) await supabase.from('processing_jobs').update({ status: 'failed', safe_error: 'No se pudo guardar el registro de la prenda.' }).eq('id', processingJobId).eq('user_id', user.id);
    return NextResponse.json({ error: 'No se pudo guardar el registro de la prenda. Comprueba la conexión e inténtalo de nuevo.' }, { status: 500 });
  }

  if (processingJobId && processedBytes) await supabase.from('processing_jobs').update({ status: 'completed', garment_id: garment.id }).eq('id', processingJobId).eq('user_id', user.id);

  const { data: signed } = await supabase.storage.from('garments').createSignedUrl(processedPath || objectPath, 30 * 60);
  return NextResponse.json({ garment: { ...garment, image_url: signed?.signedUrl ?? null }, processing_warning: processingWarning }, { status: 201 });
}
