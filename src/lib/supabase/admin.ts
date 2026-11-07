import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getSupabaseEnv } from './env';

/**
 * Server-only helper. Import this module only from route handlers or server code.
 * The secret key is never read by a client component and must not use a NEXT_PUBLIC_ name.
 */
export function createAdminClient() {
  const { url } = getSupabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('Falta una credencial privada de Supabase para procesar trabajos.');
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
