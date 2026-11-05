import { corsHeaders, json, preflight, safeErrorMessage, userContext } from '../_shared/http.ts';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DAILY_LIMIT = 10;

function validImage(bytes: Uint8Array, type: string) {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  return type === 'image/webp' && bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
}

Deno.serve(async request => {
  const options = preflight(request); if (options) return options;
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const context = await userContext(request); if ('response' in context) return context.response;
  const apiKey = Deno.env.get('CLIPDROP_API_KEY');
  if (!apiKey) return json({ error: 'Clipdrop no está configurado en Supabase. Se conserva la imagen original y puedes seguir usando el Closet.' }, 503);

  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_IMAGE_BYTES + 64 * 1024) return json({ error: 'La imagen supera el límite de 10 MB.' }, 413);
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: 'No se pudo leer la imagen.' }, 400); }
  if (form.get('allow_paid_processing') !== 'yes') return json({ error: 'Confirma el posible consumo de créditos antes de usar Clipdrop.' }, 400);
  const file = form.get('image');
  if (!(file instanceof File) || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return json({ error: 'Elige una foto JPG, PNG o WEBP de hasta 10 MB.' }, 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validImage(bytes, file.type)) return json({ error: 'El contenido del archivo no coincide con su formato.' }, 415);
  const jobId = String(form.get('processing_job_id') || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) return json({ error: 'Falta un identificador válido de procesamiento.' }, 400);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await context.supabase.from('processing_jobs').select('id', { count: 'exact', head: true })
    .eq('user_id', context.user.id).eq('job_type', 'background_removal').gte('created_at', since);
  if (countError) return json({ error: 'No se pudo comprobar el límite de procesamiento.' }, 500);
  if ((count || 0) >= DAILY_LIMIT) return json({ error: 'Alcanzaste el límite de 10 procesamientos en 24 horas. Puedes guardar la foto original.' }, 429);
  const { data: job, error: jobError } = await context.supabase.from('processing_jobs').insert({ id: jobId, user_id: context.user.id, job_type: 'background_removal', status: 'processing' }).select('id').single();
  if (jobError || !job) return json({ error: 'No se pudo registrar el procesamiento.' }, 500);

  const upload = new FormData(); upload.set('image_file', file, file.name || 'garment');
  try {
    const response = await fetch('https://clipdrop-api.co/remove-background/v1', {
      method: 'POST', headers: { 'x-api-key': apiKey, accept: 'image/png' }, body: upload,
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      await context.supabase.from('processing_jobs').update({ status: 'failed', safe_error: `Clipdrop HTTP ${response.status}` }).eq('id', job.id).eq('user_id', context.user.id);
      return json({ error: safeErrorMessage(response.status, 'Clipdrop') }, response.status === 402 ? 402 : response.status === 429 ? 429 : 502);
    }
    if (!response.headers.get('content-type')?.toLowerCase().includes('image/png')) throw new Error('Clipdrop devolvió un formato inesperado.');
    const result = new Uint8Array(await response.arrayBuffer());
    const png = result.length >= 26 && [137,80,78,71,13,10,26,10].every((value, index) => result[index] === value);
    if (!png || ![4,6].includes(result[25]) || result.length > MAX_IMAGE_BYTES) throw new Error('El resultado no es un PNG transparente válido.');
    await context.supabase.from('processing_jobs').update({ status: 'completed' }).eq('id', job.id).eq('user_id', context.user.id);
    return new Response(result, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo procesar la imagen.';
    await context.supabase.from('processing_jobs').update({ status: 'failed', safe_error: message.slice(0, 180) }).eq('id', job.id).eq('user_id', context.user.id);
    return json({ error: 'Clipdrop no pudo procesar la imagen. Puedes guardarla como original y continuar.' }, 502);
  }
});
