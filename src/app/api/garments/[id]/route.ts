import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseConfig()) return NextResponse.json({ error: 'Supabase no está configurado.' }, { status: 503 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Inicia sesión para editar una prenda.' }, { status: 401 });
  const { id } = await params;
  let input: Record<string, unknown>;
  try { input = await request.json(); }
  catch { return NextResponse.json({ error: 'La solicitud no tiene un formato válido.' }, { status: 400 }); }
  const update: Record<string, string | boolean | null> = {};
  for (const key of ['name', 'category', 'subcategory', 'color'] as const) {
    if (!(key in input)) continue;
    const value = input[key];
    const limit = key === 'name' ? 100 : key === 'category' || key === 'subcategory' ? 80 : 60;
    if (typeof value !== 'string' || value.length > limit || ((key === 'name' || key === 'category') && !value.trim())) {
      return NextResponse.json({ error: 'Revisa los datos de la prenda.' }, { status: 400 });
    }
    update[key] = value.trim() || null;
  }
  if ('is_favorite' in input) {
    if (typeof input.is_favorite !== 'boolean') return NextResponse.json({ error: 'El estado de favorito no es válido.' }, { status: 400 });
    update.is_favorite = input.is_favorite;
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'No hay cambios para guardar.' }, { status: 400 });
  const { data, error } = await supabase.from('garments').update(update).eq('id', id).eq('user_id', user.id)
    .select('id,name,category,subcategory,color,processing_status,is_favorite').maybeSingle();
  if (error) return NextResponse.json({ error: 'No se pudo actualizar la prenda.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'No se encontró esa prenda en tu Closet.' }, { status: 404 });
  return NextResponse.json({ garment: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseConfig()) return NextResponse.json({ error: 'Supabase no está configurado.' }, { status: 503 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Inicia sesión para eliminar una prenda.' }, { status: 401 });
  const { id } = await params;
  const { data: garment, error: findError } = await supabase.from('garments')
    .select('id,original_path,processed_path').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (findError) return NextResponse.json({ error: 'No se pudo consultar la prenda.' }, { status: 500 });
  if (!garment) return NextResponse.json({ error: 'No se encontró esa prenda en tu Closet.' }, { status: 404 });

  const { error } = await supabase.from('garments').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: 'No se pudo eliminar la prenda.' }, { status: 500 });
  const paths = [...new Set([garment.original_path, garment.processed_path].filter((path): path is string => Boolean(path)))];
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from('garments').remove(paths);
    if (storageError) console.error('Garment image cleanup failed', { garmentId: id, userId: user.id });
  }
  return new NextResponse(null, { status: 204 });
}
