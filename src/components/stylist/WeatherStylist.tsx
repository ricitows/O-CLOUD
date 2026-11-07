'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { useSignedImageRenewal } from '@/lib/images/use-signed-image-renewal';

type Recommendation = {
  weather: { temperature: number; apparentTemperature: number; precipitation: number; label: string };
  source: 'ai' | 'rules';
  aiAvailable: boolean;
  assistant_notice?: string | null;
  explanation: string;
  items: Array<{ id: string; name: string; category: string; color: string | null; image_url: string | null; image_error?: string | null }>;
};

export default function WeatherStylist({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [occasion, setOccasion] = useState('');
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [allowAdvancedSuggestion, setAllowAdvancedSuggestion] = useState(false);
  const recommendationRequestId = useRef<string | null>(null);
  const refreshRecommendationImages = useCallback(async () => {
    if (!enabled || !recommendation) return;
    try {
      const response = await fetch('/api/garments', { cache: 'no-store' });
      if (!response.ok) return false;
      const body = await response.json();
      const currentById = new Map<string, string | null>((body.garments ?? []).map((garment: { id: string; image_url: string | null }) => [garment.id, garment.image_url]));
      setRecommendation(current => current ? {
        ...current,
        items: current.items.map(item => currentById.has(item.id) ? { ...item, image_url: currentById.get(item.id) ?? null } : item),
      } : current);
      return true;
    } catch {
      // Keep the existing recommendation if image URL renewal is temporarily unavailable.
      return false;
    }
  }, [enabled, recommendation]);
  useSignedImageRenewal(refreshRecommendationImages, enabled && Boolean(recommendation));
  async function getSuggestion() {
    if (!allowAdvancedSuggestion) { setError('Autoriza la recomendación avanzada para continuar.'); return; }
    setError(''); setNotice(''); setRecommendation(null);
    setAllowAdvancedSuggestion(false);
    if (!enabled) { setError('Conecta Supabase para consultar tus prendas.'); return; }
    if (!navigator.geolocation) { setError('Este dispositivo no permite compartir la ubicación.'); return; }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const requestId = recommendationRequestId.current || crypto.randomUUID();
        recommendationRequestId.current = requestId;
        const response = await fetch('/api/stylist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, occasion, request_id: requestId, allow_paid: true }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'No se pudo crear la sugerencia.');
        recommendationRequestId.current = null;
        setRecommendation(body);
        setNotice(body.assistant_notice || (body.source === 'rules' ? 'Preparamos una sugerencia alternativa con prendas de tu Closet.' : ''));
      } catch { setError('No pudimos generar sugerencias en este momento. Inténtalo más tarde.'); }
      finally { setLoading(false); }
    }, reason => {
      setLoading(false);
      setError(reason.code === reason.PERMISSION_DENIED ? 'No compartiste tu ubicación. Puedes activarla en los ajustes del dispositivo.' : 'No se pudo obtener tu ubicación. Inténtalo de nuevo.');
    }, { enableHighAccuracy: false, timeout: 12_000, maximumAge: 10 * 60 * 1000 });
  }

  async function saveAsOutfit() {
    if (!recommendation?.items.length) return;
    setSaving(true); setError(''); setNotice('');
    const date = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' }).format(new Date());
    try {
      const response = await fetch('/api/outfits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Look del ${date}`, description: recommendation.explanation, occasion, garment_ids: recommendation.items.map(item => item.id) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'No se pudo guardar el look.');
      setNotice('Look guardado en Outfits.'); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el look.'); }
    finally { setSaving(false); }
  }

  return <section className="panel weather-stylist"><div className="weather-stylist-copy"><label>Ocasión <select value={occasion} onChange={event => { recommendationRequestId.current = null; setAllowAdvancedSuggestion(false); setOccasion(event.target.value); }}><option value="">Cualquier ocasión</option><option>Trabajo</option><option>Casual</option><option>Formal</option><option>Evento</option><option>Deporte</option></select></label><label className="paid-opt-in"><input type="checkbox" checked={allowAdvancedSuggestion} onChange={event => setAllowAdvancedSuggestion(event.target.checked)} />Autorizo el procesamiento externo, que puede generar costos, para preparar una recomendación avanzada. Sin autorización, puedes seguir usando las sugerencias habituales.</label><button className="primary-button" onClick={() => void getSuggestion()} disabled={loading || !allowAdvancedSuggestion}>{loading ? 'Consultando…' : 'Consultar clima y crear look　→'}</button><small>La ubicación se solicita al consultar el clima.</small></div>
    {recommendation ? <div className="weather-result"><div className="weather-current"><span>☼</span><b>{Math.round(recommendation.weather.temperature)}°</b><small>{recommendation.weather.label}{recommendation.weather.precipitation > 0 ? ` · ${recommendation.weather.precipitation} mm` : ''}</small></div><div className="recommendation-mode">{recommendation.items.length} prendas</div><p>{recommendation.explanation}</p><div className="recommendation-items">{recommendation.items.map(item => <div key={item.id}>{item.image_url ? <Image src={item.image_url} alt={item.name} width={56} height={62} unoptimized /> : <span>◇</span>}<small>{item.name}</small></div>)}</div><button className="outline-button" onClick={() => void saveAsOutfit()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar como outfit　＋'}</button></div> : <div className="weather-placeholder"><span>☼</span><p>{enabled ? 'Permite la ubicación al consultar para recibir una sugerencia.' : 'Inicia sesión para usar tus prendas.'}</p></div>}
    {error && <p className="garment-notice" role="alert">{error}</p>}{notice && <p className="garment-notice" role="status">{notice}</p>}
  </section>;
}
