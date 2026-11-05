'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Recommendation = {
  weather: { temperature: number; apparentTemperature: number; precipitation: number; label: string };
  source: 'ai' | 'rules';
  aiAvailable: boolean;
  assistant_notice?: string | null;
  explanation: string;
  items: Array<{ id: string; name: string; category: string; color: string | null; image_url: string | null }>;
};

export default function WeatherStylist({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [occasion, setOccasion] = useState('');
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [authorizeOpenAI, setAuthorizeOpenAI] = useState(false);

  async function getSuggestion() {
    setError(''); setNotice(''); setRecommendation(null);
    if (!enabled) { setError('Conecta Supabase para consultar tus prendas.'); return; }
    if (!navigator.geolocation) { setError('Este dispositivo no permite compartir la ubicación.'); return; }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const response = await fetch('/api/stylist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, occasion, use_ai: authorizeOpenAI, confirm_ai_cost: authorizeOpenAI }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'No se pudo crear la sugerencia.');
        setRecommendation(body);
        setNotice(body.assistant_notice || '');
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la sugerencia.'); }
      finally { setLoading(false); setAuthorizeOpenAI(false); }
    }, reason => {
      setLoading(false);
      setAuthorizeOpenAI(false);
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

  return <section className="panel weather-stylist"><div className="weather-stylist-copy"><label>Ocasión <select value={occasion} onChange={event => setOccasion(event.target.value)}><option value="">Cualquier ocasión</option><option>Trabajo</option><option>Casual</option><option>Formal</option><option>Evento</option><option>Deporte</option></select></label><details className="advanced-settings"><summary>Opciones de recomendación</summary><label className="paid-opt-in compact-paid-opt-in"><input type="checkbox" checked={authorizeOpenAI} onChange={event => setAuthorizeOpenAI(event.target.checked)} />Usar OpenAI para esta sugerencia (opcional).</label><small>Esta opción puede generar cargos y solo se usa para esta solicitud. Sin autorización, la sugerencia sigue funcionando.</small></details><button className="primary-button" onClick={() => void getSuggestion()} disabled={loading}>{loading ? 'Consultando…' : 'Consultar clima y crear look　→'}</button><small>La ubicación se solicita al pulsar y no se guarda.</small></div>
    {recommendation ? <div className="weather-result"><div className="weather-current"><span>☼</span><b>{Math.round(recommendation.weather.temperature)}°</b><small>{recommendation.weather.label}{recommendation.weather.precipitation > 0 ? ` · ${recommendation.weather.precipitation} mm` : ''}</small></div><div className="recommendation-mode">{recommendation.items.length} prendas</div><p>{recommendation.explanation}</p><div className="recommendation-items">{recommendation.items.map(item => <div key={item.id}>{item.image_url ? <Image src={item.image_url} alt={item.name} width={56} height={62} unoptimized /> : <span>◇</span>}<small>{item.name}</small></div>)}</div><button className="outline-button" onClick={() => void saveAsOutfit()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar como outfit　＋'}</button></div> : <div className="weather-placeholder"><span>☼</span><p>{enabled ? 'Permite la ubicación al consultar para recibir una sugerencia.' : 'Inicia sesión para usar tus prendas.'}</p></div>}
    {error && <p className="garment-notice" role="alert">{error}</p>}{notice && <p className="garment-notice" role="status">{notice}</p>}
  </section>;
}
