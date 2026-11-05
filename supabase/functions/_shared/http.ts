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
