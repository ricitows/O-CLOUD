import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';

type Params = { params: Promise<{ id: string }> };
type EdgeError = { context?: unknown };

function fail(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }

async function edgeMessage(error: EdgeError) {
  if (error.context instanceof Response) {
    try { const result = await error.context.clone().json(); if (typeof result.error === 'string') return result.error; } catch { /* fall through to deployment help */ }
  }
  return 'La función generate-3d no está desplegada o no responde. El Closet sigue disponible.';
}

async function context() {
  if (!hasSupabaseConfig()) return { response: fail('Supabase no está configurado.', 503) };
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: fail('Inicia sesión para usar el modelado 3D.', 401) };
  return { supabase, user };
}

export async function POST(request: Request, { params }: Params) {
  const auth = await context(); if ('response' in auth) return auth.response;
  const { id } = await params;
  let body: { allow_paid?: boolean };
  try { body = await request.json(); } catch { return fail('Confirma el posible consumo de créditos antes de llamar a Tripo.', 400); }
  if (body.allow_paid !== true) return fail('Autoriza expresamente esta generación de Tripo antes de continuar.', 400);
  const { data, error } = await auth.supabase.functions.invoke('generate-3d', { body: { action: 'start', garment_id: id, allow_paid: true } });
  if (error) return fail(await edgeMessage(error), 503);
  return NextResponse.json(data, { status: data?.status === 'processing' ? 202 : 200 });
}

export async function GET(_request: Request, { params }: Params) {
  const auth = await context(); if ('response' in auth) return auth.response;
  const { id } = await params;
  const { data, error } = await auth.supabase.functions.invoke('generate-3d', { body: { action: 'status', garment_id: id } });
  if (error) return fail(await edgeMessage(error), 503);
  return NextResponse.json(data);
}
