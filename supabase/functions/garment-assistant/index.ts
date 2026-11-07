import { dailyLimitMessageAt, isUuid, json, preflight, safeErrorMessage, serviceClient, userContext } from '../_shared/http.ts';
import { canStartProviderCall, hashJson, reserveProcessingJob, updateProcessingJob, type ProcessingJob } from '../_shared/processing.ts';

const DAILY_LIMIT = 20;

async function persist(client: NonNullable<ReturnType<typeof serviceClient>>, input: Parameters<typeof updateProcessingJob>[1]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await updateProcessingJob(client, input);
    if (!result.error) return result;
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
  }
  return { job: null, error: new Error('processing update failed') };
}

function asRecommendation(job: ProcessingJob) {
  const payload = job.result_payload;
  if (job.status !== 'completed' || !payload || !Array.isArray(payload.garment_ids) || typeof payload.explanation !== 'string') return null;
  return { garment_ids: payload.garment_ids, explanation: payload.explanation };
}

Deno.serve(async request => {
  const options = preflight(request); if (options) return options;
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const context = await userContext(request); if ('response' in context) return context.response;
  let body: { action?: string; request_id?: string; weather?: Record<string, unknown>; occasion?: string; allow_paid?: boolean };
  try { body = await request.json(); } catch { return json({ error: 'La solicitud no tiene un formato válido.' }, 400); }
  if (body.action !== 'recommend') return json({ error: 'Acción no reconocida. Esta integración solo recomienda outfits del inventario.' }, 400);
  if (!isUuid(body.request_id)) return json({ error: 'No se pudo iniciar una solicitud única de recomendación.' }, 400);
  if (body.allow_paid !== true) return json({ error: 'Se requiere autorización para generar la recomendación con OpenAI.' }, 403);
  const weather = body.weather;
  const temperature = Number(weather?.temperature);
  const apparentTemperature = Number(weather?.apparentTemperature);
  const precipitation = Number(weather?.precipitation);
  const label = typeof weather?.label === 'string' ? weather.label.slice(0,50) : '';
  if (![temperature, apparentTemperature, precipitation].every(Number.isFinite) || !label) return json({ error: 'Los datos del clima no son válidos.' }, 400);
  const occasion = typeof body.occasion === 'string' ? body.occasion.slice(0,80) : '';
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return json({ error: 'La recomendación inteligente no está disponible. La alternativa por reglas sigue activa.' }, 503);

  const { data: garments, error: inventoryError } = await context.supabase.from('garments')
    .select('id,name,category,subcategory,color,is_favorite').eq('user_id', context.user.id).order('created_at', { ascending: false }).limit(100);
  if (inventoryError) return json({ error: 'No se pudo consultar tu Closet.' }, 500);
  if (!garments?.length) return json({ error: 'Añade prendas a tu Closet antes de pedir una recomendación.' }, 409);
  const catalog = garments.map(({ id, name, category, subcategory, color, is_favorite }) => ({ id, name, category, subcategory, color, is_favorite }));
  const requestHash = await hashJson({ weather: { temperature, apparentTemperature, precipitation, label }, occasion, catalog });
  const admin = serviceClient();
  if (!admin) return json({ error: 'No está disponible el servicio seguro de procesamiento.' }, 503);

  const reserved = await reserveProcessingJob(admin, { userId: context.user.id, jobId: body.request_id, jobType: 'garment_analysis', garmentId: null, requestHash });
  if (reserved.error || !reserved.reservation) return json({ error: 'No se pudo reservar de forma segura la recomendación.' }, 503);
  const reservation = reserved.reservation;
  if (reservation.outcome === 'daily_limit') return json({ error: dailyLimitMessageAt('recomendaciones de IA', reservation.limit ?? DAILY_LIMIT, reservation.retry_at ?? null), retry_at: reservation.retry_at ?? null }, 429);
  if (reservation.outcome === 'idempotency_conflict') return json({ error: 'Este identificador ya corresponde a otra recomendación.' }, 409);
  if (reservation.outcome === 'invalid_request') return json({ error: 'La solicitud no es válida.' }, 400);
  if (reservation.outcome === 'not_found') return json({ error: 'No se encontró el inventario solicitado.' }, 404);
  if (!canStartProviderCall(reservation)) {
    const job = reservation.job;
    if (!job) return json({ error: 'No se pudo recuperar la recomendación previa.' }, 503);
    const cached = asRecommendation(job);
    if (cached) return json(cached);
    if (job.status === 'failed' || job.status === 'cancelled') return json({ error: job.safe_error || 'La recomendación anterior no se completó. Inicia una nueva solicitud.' }, 409);
    return json({ status: job.status, request_id: job.id }, 202);
  }

  const jobId = body.request_id;
  const started = await persist(admin, { userId: context.user.id, jobId, status: 'processing' });
  if (started.error) return json({ error: 'No se pudo registrar la solicitud; no se llamó al servicio de recomendaciones.' }, 503);

  const fail = async (message: string, status: number) => {
    const saved = await persist(admin, { userId: context.user.id, jobId, status: 'failed', safeError: message });
    if (saved.error) return json({ error: 'La recomendación falló y no se pudo registrar el resultado. Conserva el identificador al reintentar.' }, 503);
    return json({ error: message }, status);
  };

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_STYLIST_MODEL') || 'gpt-5.4-mini',
        reasoning: { effort: 'low' }, max_output_tokens: 300,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: 'Eres un estilista. Selecciona únicamente IDs del inventario. No inventes prendas, colores, características ni IDs. Usa el clima real y ocasión. Devuelve de 1 a 5 IDs sin duplicados y una explicación breve en español; si no hay piezas suficientes, di la limitación.' }] },
          { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ weather: { temperature, apparentTemperature, precipitation, label }, occasion, catalog }) }] },
        ],
        text: { format: { type: 'json_schema', name: 'wardrobe_recommendation', strict: true, schema: {
          type: 'object', additionalProperties: false,
          properties: {
            garment_ids: { type: 'array', items: { type: 'string', enum: catalog.map(item => item.id) } },
            explanation: { type: 'string' },
          }, required: ['garment_ids','explanation'],
        } } },
      }), signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return await fail(safeErrorMessage(response.status, 'OpenAI'), response.status === 429 ? 429 : response.status === 402 ? 402 : 502);
    const result = await response.json();
    const output = result.output?.flatMap((item: { content?: Array<{ type: string; text?: string }> }) => item.content || []).find((part: { type: string }) => part.type === 'output_text')?.text;
    if (typeof output !== 'string') return await fail('OpenAI no devolvió una recomendación válida.', 502);
    const parsed = JSON.parse(output) as { garment_ids?: unknown; explanation?: unknown };
    if (!Array.isArray(parsed.garment_ids) || typeof parsed.explanation !== 'string') return await fail('OpenAI devolvió datos incompletos.', 502);
    const allowed = new Set(garments.map(item => item.id));
    const ids = [...new Set(parsed.garment_ids.filter((id): id is string => typeof id === 'string' && allowed.has(id)))].slice(0,5);
    if (!ids.length) return await fail('No se identificaron prendas válidas de tu Closet.', 502);
    const recommendation = { garment_ids: ids, explanation: parsed.explanation.slice(0,300) };
    const completed = await persist(admin, { userId: context.user.id, jobId, status: 'completed', resultPayload: recommendation });
    if (completed.error) return json({ error: 'OpenAI respondió, pero no se pudo guardar el resultado. Conserva el identificador para recuperarlo sin repetir la llamada.' }, 503);
    return json(recommendation);
  } catch {
    return await fail('OpenAI no pudo completar la recomendación. Puedes seguir usando la curaduría por JavaScript.', 502);
  }
});
