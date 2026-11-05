import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseConfig()) return NextResponse.json({ error: 'Supabase no está configurado.' }, { status: 503 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Inicia sesión para editar un outfit.' }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'La solicitud no tiene un formato válido.' }, { status: 400 }); }
  const patch: Record<string, string | boolean | null> = {};
  for (const key of ['name', 'description', 'occasion', 'season'] as const) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'string') return NextResponse.json({ error: 'Revisa los datos del outfit.' }, { status: 400 });
    const value = (body[key] as string).trim();
    const max = key === 'name' ? 100 : key === 'description' ? 500 : key === 'occasion' ? 80 : 40;
    if (value.length > max || (key === 'name' && !value)) return NextResponse.json({ error: 'Revisa los datos del outfit.' }, { status: 400 });
    patch[key] = value || null;
  }
  if ('is_favorite' in body) {
    if (typeof body.is_favorite !== 'boolean') return NextResponse.json({ error: 'El favorito no es válido.' }, { status: 400 });
    patch.is_favorite = body.is_favorite;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'No hay cambios para guardar.' }, { status: 400 });
  const { id } = await params;
  const { data, error } = await supabase.from('outfits').update(patch).eq('id', id).eq('user_id', user.id).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: 'No se pudo actualizar el outfit.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'No se encontró ese outfit.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseConfig()) return NextResponse.json({ error: 'Supabase no está configurado.' }, { status: 503 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Inicia sesión para eliminar un outfit.' }, { status: 401 });
  const { id } = await params;
  const { data, error } = await supabase.from('outfits').delete().eq('id', id).eq('user_id', user.id).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: 'No se pudo eliminar el outfit.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'No se encontró ese outfit.' }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
