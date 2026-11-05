import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDate = (value: string) => ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

async function authenticated() {
  if (!hasSupabaseConfig()) return { response: NextResponse.json({ error: 'Supabase no está configurado.' }, { status: 503 }) };
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { response: NextResponse.json({ error: 'Inicia sesión para usar el calendario.' }, { status: 401 }) };
  return { supabase, user };
}

export async function GET(request: Request) {
  const auth = await authenticated();
  if ('response' in auth) return auth.response;
  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to || !validDate(from) || !validDate(to) || from > to || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > 62) {
    return NextResponse.json({ error: 'El rango de fechas no es válido (máximo 63 días).' }, { status: 400 });
  }
  const { supabase, user } = auth;
  const { data, error } = await supabase.from('outfit_calendar')
    .select('id,outfit_id,outfit_date,notes,outfits(id,name,occasion)')
    .eq('user_id', user.id).gte('outfit_date', from).lte('outfit_date', to).order('outfit_date');
  if (error) return NextResponse.json({ error: 'No se pudieron cargar las asignaciones del calendario.' }, { status: 500 });
  return NextResponse.json({ assignments: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authenticated();
  if ('response' in auth) return auth.response;
  const { supabase, user } = auth;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'La solicitud no tiene un formato válido.' }, { status: 400 }); }
  const date = typeof body.date === 'string' ? body.date : '';
  const outfitId = typeof body.outfit_id === 'string' ? body.outfit_id : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (!validDate(date) || !UUID.test(outfitId) || notes.length > 500) {
    return NextResponse.json({ error: 'Elige una fecha y un outfit válidos; las notas admiten hasta 500 caracteres.' }, { status: 400 });
  }
  const { data: owned, error: lookupError } = await supabase.from('outfits').select('id').eq('id', outfitId).eq('user_id', user.id).maybeSingle();
  if (lookupError) return NextResponse.json({ error: 'No se pudo validar el outfit.' }, { status: 500 });
  if (!owned) return NextResponse.json({ error: 'El outfit elegido no pertenece a tu cuenta.' }, { status: 403 });
  const { data, error } = await supabase.from('outfit_calendar').upsert({ user_id: user.id, outfit_id: outfitId, outfit_date: date, notes: notes || null }, { onConflict: 'user_id,outfit_date' })
    .select('id,outfit_id,outfit_date,notes,outfits(id,name,occasion)').single();
  if (error || !data) return NextResponse.json({ error: 'No se pudo guardar el outfit en esa fecha.' }, { status: 500 });
  return NextResponse.json({ assignment: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const auth = await authenticated();
  if ('response' in auth) return auth.response;
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!validDate(date)) return NextResponse.json({ error: 'La fecha no es válida.' }, { status: 400 });
  const { error } = await auth.supabase.from('outfit_calendar').delete().eq('user_id', auth.user.id).eq('outfit_date', date);
  if (error) return NextResponse.json({ error: 'No se pudo quitar la asignación.' }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
