import { corsHeaders, dailyLimitMessageAt, isUuid, json, preflight, safeErrorMessage, serviceClient, userContext } from '../_shared/http.ts';
import { canStartProviderCall, clipdropResultPath, hashBytes, isExpectedClipdropResultPath, isTrustedProcessingJob, reserveProcessingJob, updateProcessingJob } from '../_shared/processing.ts';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function validImage(bytes: Uint8Array, type: string) {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  return type === 'image/webp' && bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
}

function validTransparentPng(bytes: Uint8Array) {
  return bytes.length >= 26 && bytes.length <= MAX_IMAGE_BYTES
    && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)
    && [4,6].includes(bytes[25]);
}

async function storedResult(admin: NonNullable<ReturnType<typeof serviceClient>>, path: string) {
  const { data, error } = await admin.storage.from('garments').download(path);
  if (error || !data) return null;
  if (data.type && data.type.toLowerCase() !== 'image/png') return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  return validTransparentPng(bytes) ? bytes : null;
}

async function persist(client: NonNullable<ReturnType<typeof serviceClient>>, input: Parameters<typeof updateProcessingJob>[1]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await updateProcessingJob(client, input);
    if (!result.error) return result;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return { job: null, error: new Error('processing update failed') };
}

Deno.serve(async request => {
  const options = preflight(request); if (options) return options;
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const context = await userContext(request); if ('response' in context) return context.response;

  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_IMAGE_BYTES + 64 * 1024) return json({ error: 'La imagen supera el límite de 10 MB.' }, 413);
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: 'No se pudo leer la imagen.' }, 400); }
  const file = form.get('image');
  const jobId = form.get('processing_job_id');
  if (!(file instanceof File) || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return json({ error: 'Elige una foto JPG, PNG o WEBP de hasta 10 MB.' }, 400);
  }
  if (!validImage(new Uint8Array(await file.slice(0, 12).arrayBuffer()), file.type)) return json({ error: 'El contenido del archivo no coincide con su formato.' }, 415);
  if (!isUuid(jobId)) return json({ error: 'Falta un identificador válido de procesamiento.' }, 400);
  if (form.get('allow_paid') !== 'yes') return json({ error: 'Se requiere autorización para procesar esta imagen con Clipdrop.' }, 403);
  const apiKey = Deno.env.get('CLIPDROP_API_KEY');
  if (!apiKey) return json({ error: 'Clipdrop no está configurado. Se conserva la imagen original.' }, 503);
  const admin = serviceClient();
  if (!admin) return json({ error: 'No está disponible el servicio seguro de procesamiento.' }, 503);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const requestHash = await hashBytes(bytes);
  const reservationResult = await reserveProcessingJob(admin, {
    userId: context.user.id, jobId, jobType: 'background_removal', garmentId: null, requestHash,
  });
  if (reservationResult.error || !reservationResult.reservation) return json({ error: 'No se pudo reservar de forma segura el procesamiento.' }, 503);
  const reservation = reservationResult.reservation;
  if (reservation.outcome === 'daily_limit') {
    return json({ error: dailyLimitMessageAt('procesamientos de Clipdrop', reservation.limit ?? 10, reservation.retry_at ?? null), retry_at: reservation.retry_at ?? null }, 429);
  }
  if (reservation.outcome === 'idempotency_conflict') return json({ error: 'Este identificador ya corresponde a otra solicitud. Inicia una nueva operación.' }, 409);
  if (!canStartProviderCall(reservation)) {
    const job = reservation.job;
    if (!isTrustedProcessingJob(job, context.user.id, 'background_removal', null) || job.id !== jobId) {
      return json({ error: 'No se pudo validar una reserva privada de Clipdrop. Inicia una solicitud nueva.' }, 409);
    }
    if (job?.status === 'completed' && job.result_path) {
      if (!isExpectedClipdropResultPath(job, context.user.id, jobId)) return json({ error: 'La ruta del resultado no corresponde a esta operación privada.' }, 403);
      const result = await storedResult(admin, job.result_path);
      if (!result) return json({ error: 'El resultado procesado ya no está disponible. No se repetirá el procesamiento automáticamente.' }, 410);
      return new Response(result, { headers: { ...corsHeaders, 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
    }
    if (job && (job.status === 'pending' || job.status === 'processing')) {
      const resultPath = clipdropResultPath(context.user.id, job.id);
      if (job.result_path && !isExpectedClipdropResultPath(job, context.user.id, job.id)) return json({ error: 'La ruta del resultado no corresponde a esta operación privada.' }, 403);
      const result = await storedResult(admin, resultPath);
      if (result) {
        const saved = await persist(admin, { userId: context.user.id, jobId: job.id, status: 'completed', resultPath });
        if (saved.error) return json({ error: 'El resultado existe, pero no se pudo registrar. Conserva el identificador y vuelve a consultar.' }, 503);
        return new Response(result, { headers: { ...corsHeaders, 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
      }
    }
    if (job?.status === 'failed' || job?.status === 'cancelled') return json({ error: job.safe_error || 'Ese procesamiento ya terminó sin resultado. Inicia una nueva operación para volver a intentarlo.' }, 409);
    return json({ status: 'processing', request_id: job?.id ?? jobId }, 202);
  }

  const started = await persist(admin, { userId: context.user.id, jobId, status: 'processing' });
  if (started.error) return json({ error: 'No se pudo registrar el inicio del procesamiento; no se llamó a Clipdrop.' }, 503);

  const fail = async (message: string, status: number) => {
    const persisted = await persist(admin, { userId: context.user.id, jobId, status: 'failed', safeError: message });
    if (persisted.error) return json({ error: 'El proveedor respondió, pero no se pudo guardar el estado. Conserva el identificador y consulta el estado antes de reintentar.' }, 503);
    return json({ error: message }, status);
  };

  try {
    const upload = new FormData(); upload.set('image_file', file, file.name || 'garment');
    const response = await fetch('https://clipdrop-api.co/remove-background/v1', {
      method: 'POST', headers: { 'x-api-key': apiKey, accept: 'image/png' }, body: upload,
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) return await fail(safeErrorMessage(response.status, 'Clipdrop'), response.status === 402 ? 402 : response.status === 429 ? 429 : 502);
    if (!response.headers.get('content-type')?.toLowerCase().includes('image/png')) return await fail('Clipdrop devolvió un formato inesperado.', 502);
    const result = new Uint8Array(await response.arrayBuffer());
    if (!validTransparentPng(result)) return await fail('Clipdrop devolvió un PNG transparente no válido.', 502);

    const resultPath = clipdropResultPath(context.user.id, jobId);
    const { error: uploadError } = await admin.storage.from('garments').upload(resultPath, result, {
      contentType: 'image/png', cacheControl: '3600', upsert: false,
    });
    if (uploadError) return await fail('No se pudo guardar el resultado privado de Clipdrop.', 502);
    const completed = await persist(admin, { userId: context.user.id, jobId, status: 'completed', resultPath });
    if (completed.error) return json({ error: 'Clipdrop terminó, pero el resultado no se pudo registrar. Conserva el identificador para recuperar el resultado sin repetir la llamada.' }, 503);
    return new Response(result, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } });
  } catch {
    return await fail('Clipdrop no pudo procesar la imagen. Puedes guardar la fotografía original.', 502);
  }
});
