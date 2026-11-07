import { dailyLimitMessageAt, isUuid, json, preflight, safeErrorMessage, serviceClient, userContext } from '../_shared/http.ts';
import { canStartProviderCall, hashBytes, isTrustedProcessingJob, reserveProcessingJob, updateProcessingJob } from '../_shared/processing.ts';

const API = 'https://openapi.tripo3d.com/v3';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_GLB_BYTES = 35 * 1024 * 1024;
const DAILY_LIMIT = 3;
type AuthenticatedContext = Extract<Awaited<ReturnType<typeof userContext>>, { supabase: unknown }>;

function hasImageSignature(bytes: Uint8Array, contentType: string) {
  if (contentType === 'image/png') return [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value);
  return contentType === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}

async function persist(client: NonNullable<ReturnType<typeof serviceClient>>, input: Parameters<typeof updateProcessingJob>[1]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await updateProcessingJob(client, input);
    if (!result.error) return result;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return { job: null, error: new Error('processing update failed') };
}

async function completedModel(context: AuthenticatedContext, garmentId: string): Promise<Response | null> {
  const { data: garment } = await context.supabase.from('garments').select('model_3d_path')
    .eq('id', garmentId).eq('user_id', context.user.id).maybeSingle();
  if (!garment?.model_3d_path) return null;
  const { data: signed, error } = await context.supabase.storage.from('garments').createSignedUrl(garment.model_3d_path, 30 * 60);
  if (error || !signed?.signedUrl) return json({ error: 'El modelo está guardado, pero no se pudo crear un enlace privado.' }, 502);
  return json({ status: 'completed', model_url: signed.signedUrl });
}

Deno.serve(async request => {
  const options = preflight(request); if (options) return options;
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const context = await userContext(request); if ('response' in context) return context.response;
  let body: { action?: string; garment_id?: string; request_id?: string };
  try { body = await request.json(); } catch { return json({ error: 'La solicitud no tiene un formato válido.' }, 400); }
  const garmentId = typeof body.garment_id === 'string' ? body.garment_id : '';
  if (!isUuid(garmentId)) return json({ error: 'Selecciona una prenda válida.' }, 400);
  const { data: garment, error: garmentError } = await context.supabase.from('garments')
    .select('id,user_id,original_path,processed_path,model_3d_path').eq('id', garmentId).eq('user_id', context.user.id).maybeSingle();
  if (garmentError) return json({ error: 'No se pudo consultar la prenda.' }, 500);
  if (!garment) return json({ error: 'No se encontró esa prenda en tu Closet.' }, 404);

  if (garment.model_3d_path) {
    const { data: signed, error } = await context.supabase.storage.from('garments').createSignedUrl(garment.model_3d_path, 30 * 60);
    if (error || !signed?.signedUrl) return json({ error: 'El modelo está guardado, pero no se pudo crear un enlace privado.' }, 502);
    return json({ status: 'completed', model_url: signed.signedUrl });
  }

  if (body.action === 'status') {
    const admin = serviceClient();
    if (!admin) return json({ error: 'No está disponible el servicio seguro de procesamiento.' }, 503);
    const { data: job, error } = await context.supabase.from('processing_jobs').select('id,user_id,job_type,garment_id,status,provider_reference,lease_expires_at,safe_error,server_reserved_at')
      .eq('user_id', context.user.id).eq('garment_id', garmentId).eq('job_type', 'model_3d').not('server_reserved_at', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) return json({ error: 'No se pudo consultar el estado del modelo.' }, 500);
    if (!job) return json({ status: 'not_started' });
    if (!isTrustedProcessingJob(job, context.user.id, 'model_3d', garmentId)) return json({ error: 'No se pudo validar la reserva privada de esta generación.' }, 403);
    if (job.status === 'failed' || job.status === 'cancelled') return json({ status: 'failed', message: job.safe_error || 'La generación anterior no se completó. Puedes reintentar.' });
    if (!job.provider_reference) {
      const leaseExpired = !job.lease_expires_at || Date.parse(job.lease_expires_at) <= Date.now();
      if (leaseExpired) {
        const expired = await persist(admin, { userId: context.user.id, jobId: job.id, status: 'failed', safeError: 'La generación expiró antes de recibir una referencia del proveedor.' });
        if (expired.error) return json({ error: 'No se pudo cerrar el intento vencido. No se iniciará otra generación.' }, 503);
        return json({ status: 'failed', message: 'La generación anterior expiró antes de iniciar. Puedes reintentar.' });
      }
      return json({ status: 'processing', progress: 0 });
    }
    if (job.status !== 'processing') return json({ status: job.status });

    const apiKey = Deno.env.get('TRIPO_API_KEY');
    if (!apiKey) return json({ error: 'La generación 3D no está disponible en este momento.' }, 503);
    const renewed = await persist(admin, { userId: context.user.id, jobId: job.id, status: 'processing' });
    if (renewed.error) return json({ error: 'No se pudo renovar el seguimiento de la generación.' }, 503);
    try {
      const response = await fetch(API + '/tasks/' + encodeURIComponent(job.provider_reference), { headers: { authorization: 'Bearer ' + apiKey }, signal: AbortSignal.timeout(15_000) });
      const payload = await response.json(); const task = payload?.data;
      if (!response.ok || payload.code !== 0 || !task) return json({ error: safeErrorMessage(response.status, 'Tripo') }, 502);
      if (['failed','cancelled','banned'].includes(task.status)) {
        const saved = await persist(admin, { userId: context.user.id, jobId: job.id, status: 'failed', safeError: 'Tripo no pudo completar el modelo.' });
        if (saved.error) return json({ error: 'Tripo terminó la generación, pero no se pudo guardar su estado.' }, 503);
        return json({ status: 'failed', message: 'Tripo no pudo completar el modelo. Puedes seguir usando el Closet.' });
      }
      if (task.status !== 'success') return json({ status: 'processing', progress: Number(task.progress) || 0 });
      const modelUrl = new URL(task.output?.model_url);
      if (modelUrl.protocol !== 'https:' || !modelUrl.hostname.endsWith('.tripo3d.ai') || modelUrl.username || modelUrl.password) return json({ error: 'Tripo devolvió una dirección de modelo no permitida.' }, 502);
      const modelResponse = await fetch(modelUrl, { redirect: 'error', signal: AbortSignal.timeout(45_000) });
      if (!modelResponse.ok) return json({ error: 'No se pudo descargar el modelo temporal de Tripo.' }, 502);
      if (Number(modelResponse.headers.get('content-length') || 0) > MAX_GLB_BYTES) return json({ error: 'El modelo GLB supera el límite permitido.' }, 413);
      const model = new Uint8Array(await modelResponse.arrayBuffer());
      if (model.length < 12 || model.length > MAX_GLB_BYTES || String.fromCharCode(...model.slice(0,4)) !== 'glTF') return json({ error: 'Tripo devolvió un archivo GLB no válido.' }, 502);
      const modelPath = context.user.id + '/models/' + garmentId + '.glb';
      const { error: uploadError } = await admin.storage.from('garments').upload(modelPath, model, { contentType: 'model/gltf-binary', upsert: true, cacheControl: '3600' });
      if (uploadError) return json({ error: 'No se pudo guardar el modelo privado.' }, 502);
      const { error: garmentUpdateError } = await context.supabase.from('garments').update({ model_3d_path: modelPath }).eq('id', garmentId).eq('user_id', context.user.id);
      if (garmentUpdateError) return json({ error: 'El GLB se guardó, pero no se pudo asociar a la prenda.' }, 500);
      const saved = await persist(admin, { userId: context.user.id, jobId: job.id, status: 'completed', resultPath: modelPath });
      if (saved.error) return json({ error: 'El modelo quedó asociado, pero no se pudo registrar el trabajo. Vuelve a consultar el estado antes de reintentar.' }, 503);
      return await completedModel(context, garmentId) ?? json({ error: 'No se pudo recuperar el modelo recién guardado.' }, 502);
    } catch {
      return json({ error: 'No se pudo consultar el resultado de Tripo. No se iniciará otra generación automáticamente.' }, 502);
    }
  }

  if (body.action !== 'start') return json({ error: 'Acción no reconocida.' }, 400);
  if (!isUuid(body.request_id)) return json({ error: 'No se pudo iniciar una solicitud única de modelado.' }, 400);
  const apiKey = Deno.env.get('TRIPO_API_KEY');
  if (!apiKey) return json({ error: 'La generación 3D no está disponible en este momento.' }, 503);
  const sourcePath = garment.processed_path || garment.original_path;
  if (!sourcePath || !sourcePath.startsWith(context.user.id + '/') || !/\.(png|jpe?g)$/i.test(sourcePath)) return json({ error: 'Se requiere una imagen privada JPG o PNG de tu Closet.' }, 415);
  const { data: image, error: downloadError } = await context.supabase.storage.from('garments').download(sourcePath);
  if (downloadError || !image || image.size > MAX_IMAGE_BYTES) return json({ error: 'No se pudo leer tu imagen o supera el máximo de 10 MB.' }, 413);
  const mime = sourcePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!hasImageSignature(bytes, mime)) return json({ error: 'La imagen guardada no coincide con su formato.' }, 415);
  const requestHash = await hashBytes(new TextEncoder().encode(garmentId + ':' + sourcePath + ':' + await hashBytes(bytes)));
  const admin = serviceClient();
  if (!admin) return json({ error: 'No está disponible el servicio seguro de procesamiento.' }, 503);
  const reservationResult = await reserveProcessingJob(admin, { userId: context.user.id, jobId: body.request_id, jobType: 'model_3d', garmentId, requestHash });
  if (reservationResult.error || !reservationResult.reservation) return json({ error: 'No se pudo reservar de forma segura la generación 3D.' }, 503);
  const reservation = reservationResult.reservation;
  if (reservation.outcome === 'daily_limit') return json({ error: dailyLimitMessageAt('modelos 3D', reservation.limit ?? DAILY_LIMIT, reservation.retry_at ?? null), retry_at: reservation.retry_at ?? null }, 429);
  if (reservation.outcome === 'idempotency_conflict') return json({ error: 'Este identificador ya corresponde a otra generación.' }, 409);
  if (reservation.outcome === 'not_found') return json({ error: 'No se encontró esa prenda en tu Closet.' }, 404);
  if (reservation.outcome === 'invalid_request') return json({ error: 'La solicitud no es válida.' }, 400);
  if (!canStartProviderCall(reservation)) {
    const job = reservation.job;
    if (!isTrustedProcessingJob(job, context.user.id, 'model_3d', garmentId) || job.id !== body.request_id) {
      return json({ error: 'No se pudo validar una reserva privada de Tripo. Inicia una solicitud nueva.' }, 409);
    }
    if (!job) return json({ error: 'No se pudo recuperar la generación anterior.' }, 503);
    if (job.status === 'completed') return await completedModel(context, garmentId) ?? json({ error: 'La generación figura completa, pero el modelo no está asociado.' }, 503);
    if (job.status === 'failed' || job.status === 'cancelled') return json({ error: job.safe_error || 'La generación anterior terminó. Inicia un nuevo intento.' }, 409);
    return json({ status: 'processing', progress: 0, request_id: job.id }, 202);
  }

  const jobId = body.request_id;
  const started = await persist(admin, { userId: context.user.id, jobId, status: 'processing' });
  if (started.error) return json({ error: 'No se pudo registrar el inicio; no se llamó a Tripo.' }, 503);
  const fail = async (message: string, status = 502) => {
    const saved = await persist(admin, { userId: context.user.id, jobId, status: 'failed', safeError: message });
    if (saved.error) return json({ error: 'Tripo pudo haber iniciado la tarea, pero no se pudo registrar su estado. Conserva el identificador y consulta antes de reintentar.' }, 503);
    return json({ error: message }, status);
  };

  try {
    const fileForm = new FormData(); fileForm.set('file', new Blob([bytes], { type: mime }), sourcePath.split('/').pop() || 'garment');
    const fileResponse = await fetch(API + '/files', { method: 'POST', headers: { authorization: 'Bearer ' + apiKey }, body: fileForm, signal: AbortSignal.timeout(30_000) });
    const filePayload = await fileResponse.json(); const fileToken = filePayload?.data?.file_token;
    if (!fileResponse.ok || filePayload.code !== 0 || typeof fileToken !== 'string') return await fail(safeErrorMessage(fileResponse.status, 'Tripo'));
    const taskResponse = await fetch(API + '/generation/image-to-model', {
      method: 'POST', headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ input: fileToken, model: 'v3.1-20260211', texture: true, face_limit: 50000, compress: 'geometry' }), signal: AbortSignal.timeout(30_000),
    });
    const taskPayload = await taskResponse.json(); const taskId = taskPayload?.data?.task_id;
    if (!taskResponse.ok || taskPayload.code !== 0 || typeof taskId !== 'string') return await fail(safeErrorMessage(taskResponse.status, 'Tripo'));
    const tracked = await persist(admin, { userId: context.user.id, jobId, status: 'processing', providerReference: taskId });
    if (tracked.error) return json({ error: 'Tripo inició la tarea, pero no se pudo guardar su referencia. Conserva el identificador y consulta el estado antes de reintentar.' }, 503);
    return json({ status: 'processing', progress: 0, request_id: jobId }, 202);
  } catch {
    return await fail('Tripo no pudo iniciar la generación. Puedes volver a intentarlo más tarde.');
  }
});
