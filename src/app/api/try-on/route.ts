import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveSignedImageUrl, SIGNED_IMAGE_TTL_SECONDS } from '@/lib/images/signed-image';
import { hasSupabaseConfig } from '@/lib/supabase/env';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const IMAGE_MIME = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);
const DAILY_TRY_ON_LIMIT = 3;

function error(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }
async function getAuth() {
  if (!hasSupabaseConfig()) return { response: error('Supabase no está configurado.', 503) };
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: error('Inicia sesión para usar el probador virtual.', 401) };
  return { supabase, user };
}

function mimeFromPath(path: string) {
  return path.toLowerCase().endsWith('.png') ? 'image/png' : path.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}
function hasImageSignature(bytes: Uint8Array, mime: string) {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
  return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
}

async function requestHash(bytes: Uint8Array, outfitId: string, garmentId: string) {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer as ArrayBuffer);
  const imageHash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  const input = new TextEncoder().encode(JSON.stringify({ imageHash, outfitId, garmentId }));
  const hash = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function updateProcessingJob(admin: ReturnType<typeof createAdminClient>, userId: string, jobId: string, values: {
  status: 'processing' | 'completed' | 'failed'; providerReference?: string | null; safeError?: string | null; resultPath?: string | null;
}) {
  return admin.rpc('update_processing_job', {
    p_user_id: userId, p_job_id: jobId, p_status: values.status,
    p_provider_reference: values.providerReference ?? null,
    p_safe_error: values.safeError ?? null,
    p_result_path: values.resultPath ?? null,
    p_result_payload: null,
    p_garment_id: null,
  });
}

export async function POST(request: Request) {
  const auth = await getAuth(); if ('response' in auth) return auth.response;
  const apiKey = process.env.FASHN_API_KEY;
  if (!apiKey) return error('El probador virtual no está conectado. Configura FASHN_API_KEY en el servidor.', 503);
  const size = Number(request.headers.get('content-length') || 0);
  if (size > MAX_IMAGE_SIZE + 64 * 1024) return error('La fotografía supera el límite de 10 MB.', 413);
  let form: FormData;
  try { form = await request.formData(); } catch { return error('No se pudo leer la solicitud.', 400); }
  const modelImage = form.get('model_image');
  const outfitId = String(form.get('outfit_id') || '');
  const garmentId = String(form.get('garment_id') || '');
  const consent = form.get('consent') === 'yes';
  const allowPaid = form.get('allow_paid') === 'yes';
  if (!allowPaid) return error('Autoriza expresamente esta llamada a FASHN, que puede consumir créditos, antes de continuar.', 400);
  if (!consent) return error('Confirma que tienes autorización para usar esta fotografía y enviarla al proveedor de IA.', 400);
  if (!(modelImage instanceof File) || !IMAGE_MIME.has(modelImage.type) || modelImage.size <= 0 || modelImage.size > MAX_IMAGE_SIZE) return error('Elige una foto JPG, PNG o WEBP de hasta 10 MB.', 400);
  if (!outfitId || !garmentId) return error('Elige un outfit guardado y una prenda de ese outfit.', 400);
  const modelBytes = new Uint8Array(await modelImage.arrayBuffer());
  if (!hasImageSignature(modelBytes, modelImage.type)) return error('El contenido de la fotografía no coincide con el formato declarado.', 400);

  const { supabase, user } = auth;
  const { data: outfit, error: outfitError } = await supabase.from('outfits').select('id').eq('id', outfitId).eq('user_id', user.id).maybeSingle();
  if (outfitError) return error('No se pudo comprobar el outfit.', 500);
  if (!outfit) return error('No se encontró ese outfit.', 404);
  const { data: outfitItem, error: itemError } = await supabase.from('outfit_items').select('garment_id').eq('user_id', user.id).eq('outfit_id', outfitId).eq('garment_id', garmentId).maybeSingle();
  if (itemError) return error('No se pudo validar la prenda.', 500);
  if (!outfitItem) return error('La prenda no forma parte de ese outfit.', 403);
  const { data: garment, error: garmentError } = await supabase.from('garments').select('id,original_path,processed_path').eq('id', garmentId).eq('user_id', user.id).maybeSingle();
  if (garmentError || !garment) return error('No se encontró la prenda en tu Closet.', 404);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase.from('processing_jobs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('job_type', 'virtual_try_on').not('server_reserved_at', 'is', null).gte('created_at', since);
  if (countError) return error('No se pudo comprobar el límite de uso.', 500);
  if ((count || 0) >= DAILY_TRY_ON_LIMIT) return error('Alcanzaste el límite de 3 pruebas virtuales en 24 horas.', 429);

  let providerBalance = 0;
  try {
    const balance = await fetch('https://api.fashn.ai/v1/credits', { headers: { authorization: `Bearer ${apiKey}` }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!balance.ok) return error('No se pudo comprobar el saldo del proveedor. Revisa su cuenta e inténtalo de nuevo.', 503);
    const data = await balance.json(); providerBalance = Number(data.credits?.total || 0);
  } catch { return error('No se pudo conectar con el proveedor del probador.', 502); }
  if (providerBalance < 1) return error('La cuenta FASHN no tiene créditos disponibles.', 402);

  const garmentPath = garment.processed_path || garment.original_path;
  if (!garmentPath) return error('La prenda no tiene una imagen disponible.', 409);
  const { data: garmentBlob, error: downloadError } = await supabase.storage.from('garments').download(garmentPath);
  if (downloadError || !garmentBlob) return error('No se pudo abrir la imagen privada de la prenda.', 502);
  const garmentBytes = new Uint8Array(await garmentBlob.arrayBuffer());
  if (!hasImageSignature(garmentBytes, mimeFromPath(garmentPath))) return error('La imagen de la prenda no tiene un formato válido.', 409);
  const modelDataUrl = `data:${modelImage.type};base64,${Buffer.from(modelBytes).toString('base64')}`;
  const garmentMime = mimeFromPath(garmentPath);
  const garmentDataUrl = `data:${garmentMime};base64,${Buffer.from(garmentBytes).toString('base64')}`;

  let admin: ReturnType<typeof createAdminClient>;
  try { admin = createAdminClient(); } catch { return error('No está disponible el registro seguro de la prueba virtual.', 503); }
  const jobId = crypto.randomUUID();
  const hash = await requestHash(modelBytes, outfitId, garmentId);
  const { data: reservation, error: reservationError } = await admin.rpc('reserve_processing_job', {
    p_user_id: user.id, p_job_id: jobId, p_job_type: 'virtual_try_on', p_garment_id: garmentId, p_request_hash: hash,
  });
  if (reservationError || !reservation || reservation.outcome !== 'reserved' || reservation.job?.id !== jobId || !reservation.job?.server_reserved_at) {
    if (reservation?.outcome === 'daily_limit') return error('Alcanzaste el límite de 3 pruebas virtuales en 24 horas.', 429);
    return error('No se pudo reservar de forma segura la prueba virtual.', 503);
  }
  const job = reservation.job;
  const { error: beginError } = await updateProcessingJob(admin, user.id, jobId, { status: 'processing' });
  if (beginError) return error('No se pudo registrar el inicio. FASHN no recibió la fotografía.', 503);
  try {
    const run = await fetch('https://api.fashn.ai/v1/run', {
      method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model_name: 'tryon-max', inputs: { product_image: garmentDataUrl, model_image: modelDataUrl, resolution: '1k', generation_mode: 'fast', num_images: 1, output_format: 'jpeg', return_base64: true } }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await run.json();
    if (!run.ok || typeof data.id !== 'string') throw new Error('El proveedor no aceptó la solicitud.');
    const { data: created, error: createError } = await supabase.from('virtual_try_ons').insert({ user_id: user.id, outfit_id: outfitId, garment_id: garmentId, provider_reference: data.id, status: 'processing', consented_at: new Date().toISOString() }).select('id,status').single();
    if (createError || !created) throw new Error('No se pudo registrar la prueba en tu cuenta.');
    const { error: refError } = await updateProcessingJob(admin, user.id, job.id, { status: 'processing', providerReference: data.id });
    if (refError) return NextResponse.json({ error: 'FASHN inició la prueba, pero no se pudo guardar su referencia. Conserva este identificador y consulta el resultado antes de reintentar.', id: created.id }, { status: 503 });
    return NextResponse.json({ id: created.id, status: created.status }, { status: 202 });
  } catch (cause) {
    const { error: persistError } = await updateProcessingJob(admin, user.id, job.id, { status: 'failed', safeError: 'No se pudo iniciar la prueba virtual.' });
    if (persistError) return error('FASHN no pudo completar la solicitud y no se pudo registrar el estado. No la reenvíes hasta consultar si existe una prueba previa.', 503);
    return error(cause instanceof Error ? cause.message : 'No se pudo iniciar la prueba virtual.', 502);
  }
}

export async function GET(request: Request) {
  const auth = await getAuth(); if ('response' in auth) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return error('Falta el identificador de la prueba.', 400);
  const { supabase, user } = auth;
  const { data: record, error: recordError } = await supabase.from('virtual_try_ons').select('id,provider_reference,status,result_path').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (recordError) return error('No se pudo consultar la prueba.', 500);
  if (!record) return error('No se encontró esa prueba.', 404);
  let status = record.status; let resultPath = record.result_path;
  if (status === 'processing' && record.provider_reference && process.env.FASHN_API_KEY) {
    try {
      const response = await fetch(`https://api.fashn.ai/v1/status/${encodeURIComponent(record.provider_reference)}`, { headers: { authorization: `Bearer ${process.env.FASHN_API_KEY}` }, cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      if (!response.ok) return error('El proveedor no respondió al revisar el estado.', 502);
      const data = await response.json();
      if (data.status === 'completed' && Array.isArray(data.output) && typeof data.output[0] === 'string') {
        const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(data.output[0]);
        if (!match) return error('El proveedor devolvió un resultado no válido.', 502);
        const bytes = Buffer.from(match[1], 'base64');
        if (bytes.length > MAX_IMAGE_SIZE || !hasImageSignature(new Uint8Array(bytes), 'image/jpeg')) return error('La imagen generada no pasó la validación.', 502);
        resultPath = `${user.id}/try-on/${record.id}.jpg`;
        const { error: uploadError } = await supabase.storage.from('private-photos').upload(resultPath, bytes, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
        if (uploadError) return error('No se pudo guardar el resultado privado.', 502);
        status = 'completed';
      } else if (data.status === 'failed') status = 'failed';
      else if (['starting', 'in_queue', 'processing'].includes(data.status)) status = 'processing';
      else return error('El proveedor devolvió un estado desconocido.', 502);
      const { error: resultUpdateError } = await supabase.from('virtual_try_ons').update({ status, result_path: resultPath }).eq('id', record.id).eq('user_id', user.id);
      if (resultUpdateError) return error('No se pudo guardar el estado privado de la prueba virtual.', 500);
      const { data: job, error: jobLookupError } = await supabase.from('processing_jobs').select('id').eq('provider_reference', record.provider_reference).eq('user_id', user.id).eq('job_type', 'virtual_try_on').not('server_reserved_at', 'is', null).maybeSingle();
      if (jobLookupError) return error('No se pudo consultar el estado interno de la prueba.', 500);
      if (job) {
        const admin = createAdminClient();
        const { error: jobUpdateError } = await updateProcessingJob(admin, user.id, job.id, { status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'processing', resultPath });
        if (jobUpdateError) return error('El resultado está disponible, pero no se pudo registrar el estado interno. Consulta de nuevo antes de reintentar.', 503);
      }
    } catch { return error('No se pudo consultar el resultado del probador.', 502); }
  }
  if (resultPath) {
    const signed = await resolveSignedImageUrl(() => supabase.storage.from('private-photos').createSignedUrl(resultPath, SIGNED_IMAGE_TTL_SECONDS));
    if (!signed.url) return error(signed.error || 'El resultado está guardado, pero no se pudo preparar su enlace privado. Vuelve a consultar el resultado.', 503);
    return NextResponse.json({ id: record.id, status, result_url: signed.url });
  }
  return NextResponse.json({ id: record.id, status, result_url: null });
}

export async function DELETE(request: Request) {
  const auth = await getAuth(); if ('response' in auth) return auth.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return error('Falta el identificador de la prueba.', 400);
  const { supabase, user } = auth;
  const { data: record, error: findError } = await supabase.from('virtual_try_ons').select('id,result_path').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (findError) return error('No se pudo consultar la prueba.', 500);
  if (!record) return error('No se encontró esa prueba.', 404);
  const { error: deleteError } = await supabase.from('virtual_try_ons').delete().eq('id', id).eq('user_id', user.id);
  if (deleteError) return error('No se pudo eliminar la prueba.', 500);
  if (record.result_path) await supabase.storage.from('private-photos').remove([record.result_path]);
  return new NextResponse(null, { status: 204 });
}
