import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function preflight(request: Request) {
  return request.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null;
}

export async function userContext(request: Request): Promise<
  | { supabase: SupabaseClient; user: User }
  | { response: Response }
> {
  const authorization = request.headers.get('Authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!token) return { response: json({ error: 'Inicia sesión para usar esta función.' }, 401) };
  if (!url || !anonKey) return { response: json({ error: 'La función no tiene la configuración de Supabase necesaria.' }, 503) };

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { response: json({ error: 'La sesión no es válida. Vuelve a iniciar sesión.' }, 401) };
  return { supabase, user: data.user };
}

export function safeErrorMessage(status: number, provider: string) {
  if (status === 401 || status === 403) return `La clave de ${provider} no es válida o no tiene acceso.`;
  if (status === 402) return `${provider} no tiene créditos disponibles. Puedes seguir usando O-CLOÜD sin esta integración.`;
  if (status === 429) return `${provider} alcanzó su límite temporal. Inténtalo más tarde; el resto de O-CLOÜD sigue disponible.`;
  return `${provider} no pudo completar esta operación. Tu espacio de O-CLOÜD sigue disponible.`;
}

export function dailyLimitMessage(provider: string, limit: number, oldestCreatedAt: string | null) {
  const retryAt = oldestCreatedAt ? Date.parse(oldestCreatedAt) + 24 * 60 * 60 * 1000 : NaN;
  const retryLabel = Number.isFinite(retryAt)
    ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Tijuana' }).format(retryAt)
    : 'cuando se cumplan 24 horas desde tu procesamiento más antiguo';
  return `Alcanzaste el límite de ${limit} ${provider} en 24 horas. Podrás volver a usarlo a partir de ${retryLabel}.`;
}

export function retryDateLabel(retryAt: string | null) {
  const time = retryAt ? Date.parse(retryAt) : NaN;
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Tijuana' }).format(time)
    : 'cuando se cumplan 24 horas desde tu procesamiento más antiguo';
}

export function dailyLimitMessageAt(provider: string, limit: number, retryAt: string | null) {
  return `Alcanzaste el límite de ${limit} ${provider} en 24 horas. Podrás volver a usarlo a partir de ${retryDateLabel(retryAt)}.`;
}

export function serviceClient(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
