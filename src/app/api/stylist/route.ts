import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';
import { fallbackPick } from '@/lib/stylist/fallback';
import { resolveSignedImageUrl, SIGNED_IMAGE_TTL_SECONDS } from '@/lib/images/signed-image';

type Garment = { id: string; name: string; category: string; subcategory: string | null; color: string | null; is_favorite: boolean; original_path: string | null; processed_path: string | null };
type Weather = { temperature: number; apparentTemperature: number; precipitation: number; code: number; label: string };

function weatherLabel(code: number) {
  if (code === 0) return 'despejado';
  if ([1, 2, 3].includes(code)) return 'parcialmente nublado';
  if ([45, 48].includes(code)) return 'con niebla';
  if ([51, 53, 55, 56, 57].includes(code)) return 'llovizna';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'lluvia';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'nieve';
  if ([95, 96, 99].includes(code)) return 'tormenta';
  return 'variable';
}

export async function POST(request: Request) {
  if (!hasSupabaseConfig()) return NextResponse.json({ error: 'Supabase no está configurado.' }, { status: 503 });
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Inicia sesión para recibir una sugerencia.' }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'La solicitud no tiene un formato válido.' }, { status: 400 }); }
  const latitude = Number(body.latitude); const longitude = Number(body.longitude);
  const occasion = typeof body.occasion === 'string' ? body.occasion.trim().slice(0, 80) : '';
  const allowPaid = body.allow_paid === true;
  if (!allowPaid) return NextResponse.json({ error: 'Autoriza el procesamiento externo para solicitar una recomendación avanzada.' }, { status: 403 });
  const useAi = true;
  const requestId = body.request_id;
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return NextResponse.json({ error: 'No se pudo iniciar una solicitud única de recomendación.' }, { status: 400 });
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return NextResponse.json({ error: 'Comparte tu ubicación desde el dispositivo para consultar el clima.' }, { status: 400 });
  }

  const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
  weatherUrl.search = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), current: 'temperature_2m,apparent_temperature,precipitation,weather_code', timezone: 'auto', forecast_days: '1' }).toString();
  let current: { temperature_2m?: number; apparent_temperature?: number; precipitation?: number; weather_code?: number };
  try {
    const response = await fetch(weatherUrl, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('weather provider');
    const data = await response.json(); current = data.current;
  } catch { return NextResponse.json({ error: 'El servicio del clima no está disponible ahora. Inténtalo más tarde.' }, { status: 502 }); }
  if (!Number.isFinite(current.temperature_2m) || !Number.isFinite(current.weather_code)) return NextResponse.json({ error: 'El servicio del clima devolvió datos incompletos.' }, { status: 502 });
  const weather: Weather = { temperature: current.temperature_2m!, apparentTemperature: current.apparent_temperature ?? current.temperature_2m!, precipitation: current.precipitation ?? 0, code: current.weather_code!, label: weatherLabel(current.weather_code!) };

  const { data: garments, error: garmentError } = await supabase.from('garments')
    .select('id,name,category,subcategory,color,is_favorite,original_path,processed_path').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
  if (garmentError) return NextResponse.json({ error: 'No se pudo consultar tu Closet.' }, { status: 500 });
  if (!garments?.length) return NextResponse.json({ error: 'Añade prendas a tu Closet antes de pedir una recomendación.' }, { status: 409 });

  let recommendation: { ids: string[]; explanation: string } = { ids: fallbackPick(garments, weather).map(item => item.id), explanation: 'Una combinación pensada para el clima y la ocasión.' };
  if (!recommendation.ids.length) return NextResponse.json({ error: 'No pudimos generar sugerencias en este momento. Inténtalo más tarde.' }, { status: 503 });
  let source: 'ai' | 'rules' = 'rules';
  if (useAi) {
    const { data, error } = await supabase.functions.invoke('garment-assistant', {
      body: { action: 'recommend', request_id: requestId, weather, occasion, allow_paid: true },
    });
    if (error) { /* Keep the JavaScript fallback without exposing provider details. */ }
    else if (data && Array.isArray(data.garment_ids) && typeof data.explanation === 'string') {
      const owned = new Set((garments as Garment[]).map(item => item.id));
      const validIds = (data.garment_ids as unknown[]).filter((id): id is string => typeof id === 'string' && owned.has(id));
      const ids = [...new Set<string>(validIds)].slice(0, 5);
      if (ids.length) { recommendation = { ids, explanation: data.explanation.slice(0, 300) }; source = 'ai'; }
      // An unusable response leaves the JavaScript recommendation in place.
    }
  }
  const selected = (garments as Garment[]).filter(item => recommendation.ids.includes(item.id));
  const items = await Promise.all(selected.map(async item => {
    const path = item.processed_path || item.original_path;
    const signed = path
      ? await resolveSignedImageUrl(() => supabase.storage.from('garments').createSignedUrl(path, SIGNED_IMAGE_TTL_SECONDS))
      : { url: null, error: 'Esta prenda no tiene una fotografía guardada.' };
    return { id: item.id, name: item.name, category: item.category, subcategory: item.subcategory, color: item.color, image_url: signed.url, image_error: signed.error };
  }));
  return NextResponse.json({ weather, occasion, source, explanation: recommendation.explanation, items, aiAvailable: true, aiUsed: source === 'ai' });
}
