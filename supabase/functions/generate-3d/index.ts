import { json, preflight, safeErrorMessage, userContext } from '../_shared/http.ts';

const API = 'https://openapi.tripo3d.com/v3';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_GLB_BYTES = 35 * 1024 * 1024;
const DAILY_LIMIT = 3;

function hasImageSignature(bytes: Uint8Array, contentType: string) {
  if (contentType === 'image/png') return [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value);
  return contentType === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}

Deno.serve(async request => {
  const options = preflight(request); if (options) return options;
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const context = await userContext(request); if ('response' in context) return context.response;
  let body: { action?: string; garment_id?: string; allow_paid?: boolean };
  try { body = await request.json(); } catch { return json({ error: 'La solicitud no tiene un formato válido.' }, 400); }
  const garmentId = typeof body.garment_id === 'string' ? body.garment_id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(garmentId)) return json({ error: 'Selecciona una prenda válida.' }, 400);
  const { data: garment, error: garmentError } = await context.supabase.from('garments')
    .select('id,user_id,original_path,processed_path,model_3d_path').eq('id', garmentId).eq('user_id', context.user.id).maybeSingle();
  if (garmentError) return json({ error: 'No se pudo consultar la prenda.' }, 500);
  if (!garment) return json({ error: 'No se encontró esa prenda en tu Closet.' }, 404);

  if (body.action === 'status') {
    if (garment.model_3d_path) {
      const { data: signed } = await context.supabase.storage.from('garments').createSignedUrl(garment.model_3d_path, 30 * 60);
      return json({ status: 'completed', model_url: signed?.signedUrl ?? null });
    }
    const { data: job, error } = await context.supabase.from('processing_jobs').select('id,status,provider_reference')
      .eq('user_id', context.user.id).eq('garment_id', garmentId).eq('job_type', 'model_3d').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) return json({ error: 'No se pudo consultar el estado del modelo.' }, 500);
    if (!job) return json({ status: 'not_started' });
    if (job.status !== 'processing' || !job.provider_reference) return json({ status: job.status });
    const apiKey = Deno.env.get('TRIPO_API_KEY');
    if (!apiKey) return json({ status: 'processing', message: 'TRIPO_API_KEY no está configurada en Supabase; la tarea aún puede recuperarse al configurarla.' });
    try {
      const response = await fetch(`${API}/tasks/${encodeURIComponent(job.provider_reference)}`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
      const payload = await response.json(); const task = payload?.data;
      if (!response.ok || payload.code !== 0 || !task) return json({ error: safeErrorMessage(response.status, 'Tripo') }, 502);
      if (['failed','cancelled','banned'].includes(task.status)) {
        await context.supabase.from('processing_jobs').update({ status: 'failed', safe_error: 'Tripo no pudo completar el modelo.' }).eq('id', job.id).eq('user_id', context.user.id);
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
      const modelPath = `${context.user.id}/models/${garmentId}.glb`;
      const { error: uploadError } = await context.supabase.storage.from('garments').upload(modelPath, model, { contentType: 'model/gltf-binary', upsert: true, cacheControl: '3600' });
      if (uploadError) return json({ error: 'No se pudo guardar el modelo privado.' }, 502);
      const { error: garmentUpdateError } = await context.supabase.from('garments').update({ model_3d_path: modelPath }).eq('id', garmentId).eq('user_id', context.user.id);
      if (garmentUpdateError) return json({ error: 'El GLB se guardó, pero no se pudo asociar a la prenda.' }, 500);
      await context.supabase.from('processing_jobs').update({ status: 'completed' }).eq('id', job.id).eq('user_id', context.user.id);
      const { data: signed } = await context.supabase.storage.from('garments').createSignedUrl(modelPath, 30 * 60);
      return json({ status: 'completed', model_url: signed?.signedUrl ?? null });
    } catch { return json({ error: 'No se pudo consultar el resultado de Tripo. El resto de O-CLOÜD sigue disponible.' }, 502); }
  }

  if (body.action !== 'start') return json({ error: 'Acción no reconocida.' }, 400);
  if (body.allow_paid !== true) return json({ error: 'Confirma el posible consumo de créditos antes de llamar a Tripo.' }, 400);
  const apiKey = Deno.env.get('TRIPO_API_KEY');
  if (!apiKey) return json({ error: 'Falta el secreto TRIPO_API_KEY en Supabase Edge Functions. El Closet y el guardado de prendas siguen disponibles.' }, 503);
  if (garment.model_3d_path) {
    const { data: signed } = await context.supabase.storage.from('garments').createSignedUrl(garment.model_3d_path, 30 * 60);
    return json({ status: 'completed', model_url: signed?.signedUrl ?? null });
  }
  const { data: active, error: activeError } = await context.supabase.from('processing_jobs').select('id')
    .eq('user_id', context.user.id).eq('garment_id', garmentId).eq('job_type', 'model_3d').in('status', ['pending','processing']).limit(1).maybeSingle();
  if (activeError) return json({ error: 'No se pudo revisar si ya hay una generación activa.' }, 500);
  if (active) return json({ status: 'processing' }, 202);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await context.supabase.from('processing_jobs').select('id', { count: 'exact', head: true })
    .eq('user_id', context.user.id).eq('job_type', 'model_3d').gte('created_at', since);
  if (countError) return json({ error: 'No se pudo comprobar el límite de Tripo.' }, 500);
  if ((count || 0) >= DAILY_LIMIT) return json({ error: 'Alcanzaste el límite de tres modelos 3D en 24 horas.' }, 429);
  const sourcePath = garment.processed_path || garment.original_path;
  if (!sourcePath || !sourcePath.startsWith(`${context.user.id}/`) || !/\.(png|jpe?g)$/i.test(sourcePath)) return json({ error: 'Se requiere una imagen privada JPG o PNG de tu Closet.' }, 415);
  const { data: image, error: downloadError } = await context.supabase.storage.from('garments').download(sourcePath);
  if (downloadError || !image || image.size > MAX_IMAGE_BYTES) return json({ error: 'No se pudo leer tu imagen o supera el máximo de 10 MB.' }, 413);
  const mime = sourcePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!hasImageSignature(bytes, mime)) return json({ error: 'La imagen guardada no coincide con su formato.' }, 415);
  const { data: job, error: jobError } = await context.supabase.from('processing_jobs')
    .insert({ user_id: context.user.id, job_type: 'model_3d', status: 'pending', garment_id: garmentId }).select('id').single();
  if (jobError || !job) return json({ error: 'No se pudo registrar la generación 3D.' }, 500);
  try {
    const fileForm = new FormData(); fileForm.set('file', new Blob([bytes], { type: mime }), sourcePath.split('/').pop() || 'garment');
    const fileResponse = await fetch(`${API}/files`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: fileForm, signal: AbortSignal.timeout(30_000) });
    const filePayload = await fileResponse.json(); const fileToken = filePayload?.data?.file_token;
    if (!fileResponse.ok || filePayload.code !== 0 || typeof fileToken !== 'string') throw new Error(safeErrorMessage(fileResponse.status, 'Tripo'));
    const taskResponse = await fetch(`${API}/generation/image-to-model`, {
      method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ input: fileToken, model: 'v3.1-20260211', texture: true, face_limit: 50000, compress: 'geometry' }), signal: AbortSignal.timeout(30_000),
    });
    const taskPayload = await taskResponse.json(); const taskId = taskPayload?.data?.task_id;
    if (!taskResponse.ok || taskPayload.code !== 0 || typeof taskId !== 'string') throw new Error(safeErrorMessage(taskResponse.status, 'Tripo'));
    await context.supabase.from('processing_jobs').update({ status: 'processing', provider_reference: taskId }).eq('id', job.id).eq('user_id', context.user.id);
    return json({ status: 'processing' }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tripo no pudo iniciar el modelo.';
    await context.supabase.from('processing_jobs').update({ status: 'failed', safe_error: message.slice(0,180) }).eq('id', job.id).eq('user_id', context.user.id);
    return json({ error: `${message} Puedes seguir usando el Closet.` }, 502);
  }
});
