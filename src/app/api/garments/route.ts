import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasSupabaseConfig } from '@/lib/supabase/env';
import { normalizeGarmentImage } from '@/lib/images/normalize-garment-image';
import { garmentImagePath } from '@/lib/images/garment-image-path';
import { resolveSignedImageUrl, SIGNED_IMAGE_TTL_SECONDS } from '@/lib/images/signed-image';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function sha256(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function attachProcessingJob(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, jobId: string, garmentId: string, resultPath: string) {
  const { data: job, error: lookupError } = await supabase.from('processing_jobs').select('id,status')
    .eq('id', jobId).eq('user_id', userId).not('server_reserved_at', 'is', null).maybeSingle();
  if (lookupError) return { found: false, error: lookupError };
  if (!job) return { found: false, error: null };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('update_processing_job', {
    p_user_id: userId, p_job_id: jobId, p_status: job.status,
    p_provider_reference: null, p_safe_error: null, p_result_path: resultPath,
    p_result_payload: null, p_garment_id: garmentId,
  });
  return { found: true, error: error ?? (!data ? new Error('Processing job update was not persisted') : null) };
}
async function edgeErrorMessage(error: { context?: unknown }) {
  void error;
  return 'La prenda se guardó. La imagen original se conserva.';
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
    const path = garmentImagePath(garment.processed_path, garment.original_path);
    if (!path) return { ...garment, image_url: null, image_error: 'La prenda no tiene una fotografía guardada.' };
    const signed = await resolveSignedImageUrl(() => supabase.storage.from('garments').createSignedUrl(path, SIGNED_IMAGE_TTL_SECONDS));
    return { ...garment, image_url: signed.url, image_error: signed.error };
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
  const requestedJobId = form.get('processing_job_id');
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

  if (typeof requestedJobId !== 'string' || !UUID.test(requestedJobId)) {
    return NextResponse.json({ error: 'No se pudo identificar de forma segura esta subida. Vuelve a seleccionar la foto.' }, { status: 400 });
  }
  const processingJobId = requestedJobId;
  const imageBytes = new Uint8Array(await file.arrayBuffer());
  const imageHash = await sha256(imageBytes);
  const uploadRequestHash = await sha256(JSON.stringify({ imageHash, name, category, subcategory, color }));
  const { data: priorGarment, error: priorError } = await supabase.from('garments')
    .select('id,name,category,subcategory,color,original_path,processed_path,processing_status,is_favorite,created_at,upload_request_hash')
    .eq('upload_request_id', processingJobId).eq('user_id', user.id).maybeSingle();
  if (priorError) return NextResponse.json({ error: 'No se pudo comprobar si esta subida ya se guardó.' }, { status: 500 });
  if (priorGarment) {
    if (priorGarment.upload_request_hash !== uploadRequestHash) return NextResponse.json({ error: 'Este identificador ya corresponde a otra subida.' }, { status: 409 });
    const attached = await attachProcessingJob(supabase, user.id, processingJobId, priorGarment.id, priorGarment.processed_path || priorGarment.original_path);
    if (attached.error) return NextResponse.json({ error: 'La prenda está guardada, pero no se pudo reconciliar el estado de procesamiento. Reintenta la misma solicitud.' }, { status: 503 });
    const signed = await resolveSignedImageUrl(() => supabase.storage.from('garments').createSignedUrl(priorGarment.processed_path || priorGarment.original_path, SIGNED_IMAGE_TTL_SECONDS));
    return NextResponse.json({ garment: { ...priorGarment, image_url: signed.url, image_error: signed.error }, processing_warning: null }, { status: 200 });
  }

  const objectPath = `${user.id}/uploads/${processingJobId}.${MIME_EXTENSIONS[file.type]}`;
  const { error: uploadError } = await supabase.storage.from('garments').upload(objectPath, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: true,
  });
  if (uploadError) {
    const requestId = crypto.randomUUID();
    const storageStatus = Number(uploadError.statusCode);
    console.error('Private garment image upload failed', { requestId, storageStatus: Number.isFinite(storageStatus) ? storageStatus : null });

    let message = 'Supabase Storage no pudo guardar la imagen. Inténtalo de nuevo.';
    if (storageStatus === 401 || storageStatus === 403) {
      message = 'Supabase Storage rechazó la subida. Revisa las políticas del bucket privado “garments”.';
    } else if (storageStatus === 404) {
      message = 'Supabase Storage respondió 404 para “garments”. Comprueba que este entorno use el proyecto correcto y que el bucket exista allí.';
    } else if (storageStatus === 413) {
      message = 'La imagen supera el límite permitido por el almacenamiento. Elige una imagen menor de 10 MB.';
    } else if (storageStatus === 400) {
      message = 'Supabase Storage rechazó el formato de la imagen. Prueba con JPG, PNG o WEBP.';
    }
    return NextResponse.json({ error: message, requestId }, { status: 502 });
  }

  // Persist the original before invoking any optional provider. If Storage fails,
  // return above without starting Clipdrop or consuming its quota.
  let processedBytes: Uint8Array | null = null;
  let processingWarning: string | null = null;
  const allowClipdrop = form.get('allow_paid') === 'yes';
  if (!allowClipdrop) {
    processingWarning = 'La prenda se guardó. La imagen original se conserva.';
  } else {
    const providerForm = new FormData();
    providerForm.set('image', file, file.name || 'garment');
    providerForm.set('processing_job_id', processingJobId);
    providerForm.set('allow_paid', 'yes');
    const { data, error: functionError } = await supabase.functions.invoke('remove-background', { body: providerForm });
    if (functionError) processingWarning = await edgeErrorMessage(functionError);
    else if (data && typeof data === 'object' && 'status' in data && data.status === 'processing') {
      return NextResponse.json({ error: 'Esta fotografía ya se está procesando. Espera un momento y vuelve a intentar la misma subida.' }, { status: 409 });
    }
    else if (!(data instanceof Blob)) processingWarning = 'La prenda se guardó. La imagen original se conserva.';
    else {
      const result = new Uint8Array(await data.arrayBuffer());
      const validPng = data.type.includes('image/png') && result.length >= 26 && [137,80,78,71,13,10,26,10].every((byte,index) => result[index] === byte) && [4,6].includes(result[25]) && result.length <= MAX_FILE_SIZE;
      if (validPng) processedBytes = result;
      else processingWarning = 'La prenda se guardó. La imagen original se conserva.';
    }
  }
  const processedPath = processedBytes ? `${user.id}/processing/${processingJobId}.png` : null;
  const { data: garment, error: insertError } = await supabase.from('garments').insert({
    user_id: user.id,
    upload_request_id: processingJobId,
    upload_request_hash: uploadRequestHash,
    name,
    category,
    subcategory: subcategory || null,
    color: color || null,
    original_path: objectPath,
    processed_path: processedPath,
    processing_status: processedPath ? 'ready' : 'pending',
  }).select('id,name,category,subcategory,color,original_path,processed_path,processing_status,is_favorite,created_at').single();

  if (insertError || !garment) {
    const { data: duplicate } = await supabase.from('garments')
      .select('id,name,category,subcategory,color,original_path,processed_path,processing_status,is_favorite,created_at,upload_request_hash')
      .eq('upload_request_id', processingJobId).eq('user_id', user.id).maybeSingle();
    if (duplicate?.upload_request_hash === uploadRequestHash) {
      const attached = await attachProcessingJob(supabase, user.id, processingJobId, duplicate.id, duplicate.processed_path || duplicate.original_path);
      if (attached.error) return NextResponse.json({ error: 'La prenda está guardada, pero no se pudo reconciliar su procesamiento.' }, { status: 503 });
      const signed = await resolveSignedImageUrl(() => supabase.storage.from('garments').createSignedUrl(duplicate.processed_path || duplicate.original_path, SIGNED_IMAGE_TTL_SECONDS));
      return NextResponse.json({ garment: { ...duplicate, image_url: signed.url, image_error: signed.error }, processing_warning: processingWarning }, { status: 200 });
    }
    return NextResponse.json({ error: 'No se pudo guardar el registro de la prenda. Comprueba la conexión e inténtalo de nuevo.' }, { status: 500 });
  }

  const attached = await attachProcessingJob(supabase, user.id, processingJobId, garment.id, processedPath || objectPath);
  if (attached.error) return NextResponse.json({ error: 'La prenda está guardada, pero no se pudo registrar el estado de procesamiento. Reintenta la misma solicitud.' }, { status: 503 });

  const signed = await resolveSignedImageUrl(() => supabase.storage.from('garments').createSignedUrl(garmentImagePath(processedPath, objectPath)!, SIGNED_IMAGE_TTL_SECONDS));
  return NextResponse.json({ garment: { ...garment, image_url: signed.url, image_error: signed.error }, processing_warning: processingWarning }, { status: 201 });
}
