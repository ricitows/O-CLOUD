import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getUserClient() {
  if (!hasSupabaseConfig()) return { response: NextResponse.json({ error: 'Supabase no está configurado.' }, { status: 503 }) };
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: 'Inicia sesión para consultar tus outfits.' }, { status: 401 }) };
  return { supabase, user };
}

export async function GET() {
  const auth = await getUserClient();
  if ('response' in auth) return auth.response;
  const { supabase, user } = auth;
  const { data: outfits, error } = await supabase.from('outfits')
    .select('id,name,description,occasion,season,is_favorite,created_at')
    .eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'No se pudieron cargar tus outfits.' }, { status: 500 });

  const outfitIds = (outfits ?? []).map(outfit => outfit.id);
  const { data: links, error: linksError } = outfitIds.length
    ? await supabase.from('outfit_items').select('outfit_id,garment_id,sort_order').eq('user_id', user.id).in('outfit_id', outfitIds).order('sort_order')
    : { data: [], error: null };
  if (linksError) return NextResponse.json({ error: 'No se pudieron cargar las prendas de tus outfits.' }, { status: 500 });
  const garmentIds = [...new Set((links ?? []).map(link => link.garment_id))];
  const { data: garments, error: garmentsError } = garmentIds.length
    ? await supabase.from('garments').select('id,name,category,color,original_path,processed_path').eq('user_id', user.id).in('id', garmentIds)
    : { data: [], error: null };
  if (garmentsError) return NextResponse.json({ error: 'No se pudieron cargar las prendas.' }, { status: 500 });

  const itemById = new Map((garments ?? []).map(garment => [garment.id, garment]));
  const result = await Promise.all((outfits ?? []).map(async outfit => {
    const outfitLinks = (links ?? []).filter(link => link.outfit_id === outfit.id);
    const items = await Promise.all(outfitLinks.map(async link => {
      const garment = itemById.get(link.garment_id);
      if (!garment) return null;
      const path = garment.processed_path || garment.original_path;
      const { data } = path ? await supabase.storage.from('garments').createSignedUrl(path, 30 * 60) : { data: null };
      return { id: garment.id, name: garment.name, category: garment.category, color: garment.color, image_url: data?.signedUrl ?? null };
    }));
    return { ...outfit, items: items.filter(Boolean) };
  }));
  return NextResponse.json({ outfits: result });
}

export async function POST(request: Request) {
  const auth = await getUserClient();
  if ('response' in auth) return auth.response;
  const { supabase, user } = auth;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'La solicitud no tiene un formato válido.' }, { status: 400 }); }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const occasion = typeof body.occasion === 'string' ? body.occasion.trim() : '';
  const season = typeof body.season === 'string' ? body.season.trim() : '';
  const garmentIds = Array.isArray(body.garment_ids) ? [...new Set(body.garment_ids)] : [];
  if (!name || name.length > 100 || description.length > 500 || occasion.length > 80 || season.length > 40 || garmentIds.length < 1 || garmentIds.length > 12 || garmentIds.some(id => typeof id !== 'string' || !UUID.test(id))) {
    return NextResponse.json({ error: 'Escribe un nombre y elige entre 1 y 12 prendas de tu Closet.' }, { status: 400 });
  }
  const { data: owned, error: ownedError } = await supabase.from('garments').select('id').eq('user_id', user.id).in('id', garmentIds as string[]);
  if (ownedError) return NextResponse.json({ error: 'No se pudo validar la selección.' }, { status: 500 });
  if ((owned ?? []).length !== garmentIds.length) return NextResponse.json({ error: 'Todas las prendas deben pertenecer a tu Closet.' }, { status: 403 });

  const { data: outfit, error: outfitError } = await supabase.from('outfits').insert({
    user_id: user.id, name, description: description || null, occasion: occasion || null, season: season || null,
  }).select('id').single();
  if (outfitError || !outfit) return NextResponse.json({ error: 'No se pudo crear el outfit.' }, { status: 500 });
  const rows = (garmentIds as string[]).map((garmentId, index) => ({ user_id: user.id, outfit_id: outfit.id, garment_id: garmentId, sort_order: index }));
  const { error: itemError } = await supabase.from('outfit_items').insert(rows);
  if (itemError) {
    await supabase.from('outfits').delete().eq('id', outfit.id).eq('user_id', user.id);
    return NextResponse.json({ error: 'No se pudieron guardar las prendas del outfit.' }, { status: 500 });
  }
  return NextResponse.json({ id: outfit.id }, { status: 201 });
}
