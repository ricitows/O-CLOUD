import { json, preflight, safeErrorMessage, userContext } from '../_shared/http.ts';

const DAILY_LIMIT = 20;

Deno.serve(async request => {
  const options = preflight(request); if (options) return options;
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  const context = await userContext(request); if ('response' in context) return context.response;
  let body: { action?: string; allow_paid?: boolean; weather?: Record<string, unknown>; occasion?: string };
  try { body = await request.json(); } catch { return json({ error: 'La solicitud no tiene un formato válido.' }, 400); }
  if (body.action !== 'recommend') return json({ error: 'Acción no reconocida. Esta integración solo recomienda outfits del inventario.' }, 400);
  if (body.allow_paid !== true) return json({ error: 'Confirma el posible costo de OpenAI antes de continuar.' }, 400);
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return json({ error: 'Falta el secreto OPENAI_API_KEY en Supabase Edge Functions. La recomendación por reglas de JavaScript sigue disponible.' }, 503);
  const weather = body.weather;
  const temperature = Number(weather?.temperature);
  const apparentTemperature = Number(weather?.apparentTemperature);
  const precipitation = Number(weather?.precipitation);
  const label = typeof weather?.label === 'string' ? weather.label.slice(0,50) : '';
  if (![temperature, apparentTemperature, precipitation].every(Number.isFinite) || !label) return json({ error: 'Los datos del clima no son válidos.' }, 400);
  const occasion = typeof body.occasion === 'string' ? body.occasion.slice(0,80) : '';

  // The user-scoped client plus RLS ensures the model only receives this user's inventory.
  const { data: garments, error: inventoryError } = await context.supabase.from('garments')
    .select('id,name,category,subcategory,color,is_favorite').eq('user_id', context.user.id).order('created_at', { ascending: false }).limit(100);
  if (inventoryError) return json({ error: 'No se pudo consultar tu Closet.' }, 500);
  if (!garments?.length) return json({ error: 'Añade prendas a tu Closet antes de pedir una recomendación.' }, 409);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await context.supabase.from('processing_jobs').select('id', { count: 'exact', head: true })
    .eq('user_id', context.user.id).eq('job_type', 'garment_analysis').gte('created_at', since);
  if (countError) return json({ error: 'No se pudo comprobar el límite de OpenAI.' }, 500);
  if ((count || 0) >= DAILY_LIMIT) return json({ error: 'Alcanzaste el límite de 20 recomendaciones asistidas en 24 horas.' }, 429);
  const { data: job, error: jobError } = await context.supabase.from('processing_jobs')
    .insert({ user_id: context.user.id, job_type: 'garment_analysis', status: 'processing' }).select('id').single();
  if (jobError || !job) return json({ error: 'No se pudo registrar la recomendación.' }, 500);

  try {
    const catalog = garments.map(({ id, name, category, subcategory, color, is_favorite }) => ({ id, name, category, subcategory, color, is_favorite }));
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
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
    if (!response.ok) {
      await context.supabase.from('processing_jobs').update({ status: 'failed', safe_error: `OpenAI HTTP ${response.status}` }).eq('id', job.id).eq('user_id', context.user.id);
      return json({ error: safeErrorMessage(response.status, 'OpenAI') }, response.status === 429 ? 429 : response.status === 402 ? 402 : 502);
    }
    const result = await response.json();
    const output = result.output?.flatMap((item: { content?: Array<{ type: string; text?: string }> }) => item.content || []).find((part: { type: string }) => part.type === 'output_text')?.text;
    if (typeof output !== 'string') throw new Error('OpenAI no devolvió una recomendación válida.');
    const parsed = JSON.parse(output) as { garment_ids?: unknown; explanation?: unknown };
    if (!Array.isArray(parsed.garment_ids) || typeof parsed.explanation !== 'string') throw new Error('OpenAI devolvió datos incompletos.');
    const allowed = new Set(garments.map(item => item.id));
    const ids = [...new Set(parsed.garment_ids.filter((id): id is string => typeof id === 'string' && allowed.has(id)))].slice(0,5);
    if (!ids.length) throw new Error('No se identificaron prendas válidas de tu Closet.');
    await context.supabase.from('processing_jobs').update({ status: 'completed' }).eq('id', job.id).eq('user_id', context.user.id);
    return json({ garment_ids: ids, explanation: parsed.explanation.slice(0,300) });
  } catch {
    await context.supabase.from('processing_jobs').update({ status: 'failed', safe_error: 'No se pudo generar una recomendación estructurada.' }).eq('id', job.id).eq('user_id', context.user.id);
    return json({ error: 'OpenAI no pudo completar la recomendación. Puedes seguir usando la curaduría por JavaScript.' }, 502);
  }
});
