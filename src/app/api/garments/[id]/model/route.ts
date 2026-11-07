import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';

type Params = { params: Promise<{ id: string }> };
type EdgeError = { context?: unknown };

function fail(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }
function modelResponse(data: { model_url?: unknown } & Record<string, unknown>) {
  return NextResponse.json(typeof data.model_url === 'string' ? { ...data, url: data.model_url } : data);
}

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
  let body: { request_id?: string };
  try { body = await request.json(); } catch { return fail('La solicitud no tiene un formato válido.', 400); }
  const requestId = body.request_id;
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return fail('No se pudo iniciar una solicitud única de modelado.', 400);
  const { data, error } = await auth.supabase.functions.invoke('generate-3d', { body: { action: 'start', garment_id: id, request_id: requestId } });
  if (error) return fail(await edgeMessage(error), 503);
  if (data?.status === 'processing') return NextResponse.json(data, { status: 202 });
  return modelResponse(data);
}

export async function GET(_request: Request, { params }: Params) {
  const auth = await context(); if ('response' in auth) return auth.response;
  const { id } = await params;
  const { data, error } = await auth.supabase.functions.invoke('generate-3d', { body: { action: 'status', garment_id: id } });
  if (error) return fail(await edgeMessage(error), 503);
  return modelResponse(data);
}
