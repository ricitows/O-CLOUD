'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import VirtualTryOn from './VirtualTryOn';
import WeatherStylist from '@/components/stylist/WeatherStylist';
import { useSignedImageRenewal } from '@/lib/images/use-signed-image-renewal';

type Garment = { id: string; name: string; category: string; color: string | null; image_url: string | null; image_error?: string | null };
type Outfit = { id: string; name: string; description: string | null; occasion: string | null; season: string | null; is_favorite: boolean; items: Garment[] };

export default function OutfitStudio({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [garments, setGarments] = useState<Garment[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [occasion, setOccasion] = useState('');
  const [season, setSeason] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    if (!enabled) return false;
    setLoading(true); setError('');
    try {
      const [garmentResponse, outfitResponse] = await Promise.all([fetch('/api/garments', { cache: 'no-store' }), fetch('/api/outfits', { cache: 'no-store' })]);
      const garmentBody = await garmentResponse.json(); const outfitBody = await outfitResponse.json();
      if (!garmentResponse.ok) throw new Error(garmentBody.error || 'No se pudieron cargar las prendas.');
      if (!outfitResponse.ok) throw new Error(outfitBody.error || 'No se pudieron cargar los outfits.');
      setGarments(garmentBody.garments); setOutfits(outfitBody.outfits);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar tus datos.'); return false; }
    finally { setLoading(false); }
  }, [enabled]);
  useSignedImageRenewal(refresh, enabled);
  useEffect(() => { void refresh(); }, [refresh]);

  const sortedOutfits = useMemo(() => [...outfits].sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite)), [outfits]);
  const featuredOutfit = sortedOutfits[0];
  const otherFavorites = sortedOutfits.slice(1).filter(outfit => outfit.is_favorite);
  const recentOutfits = outfits.filter(outfit => !outfit.is_favorite && outfit.id !== featuredOutfit?.id);
  const selectedGarments = selected.map(id => garments.find(item => item.id === id)).filter((item): item is Garment => Boolean(item));
  function toggleGarment(id: string) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 12 ? [...current, id] : current); }

  async function createOutfit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/outfits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, description, occasion, season, garment_ids: selected }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'No se pudo guardar el outfit.');
      setName(''); setDescription(''); setOccasion(''); setSeason(''); setSelected([]); setCreating(false); setMessage('Outfit guardado.'); await refresh(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el outfit.'); }
    finally { setBusy(false); }
  }

  async function toggleFavorite(outfit: Outfit) {
    try {
      const response = await fetch(`/api/outfits/${outfit.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ is_favorite: !outfit.is_favorite }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'No se pudo actualizar el favorito.');
      setOutfits(current => current.map(item => item.id === outfit.id ? { ...item, is_favorite: !item.is_favorite } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el favorito.'); }
  }

  async function deleteOutfit(outfit: Outfit) {
    if (!window.confirm(`¿Eliminar “${outfit.name}”? También se quitará del calendario.`)) return;
    try {
      const response = await fetch(`/api/outfits/${outfit.id}`, { method: 'DELETE' });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'No se pudo eliminar.'); }
      setOutfits(current => current.filter(item => item.id !== outfit.id)); setMessage('Outfit eliminado.'); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el outfit.'); }
  }

  return <div className="outfit-studio phase-two-outfits">
    <div className="outfit-masthead"><div><h1>Outfits</h1></div><div className="outfit-masthead-actions"><span><b>{outfits.length.toString().padStart(2, '0')}</b> guardados</span><button className="primary-button" type="button" onClick={() => setCreating(value => !value)} disabled={!enabled || !garments.length}>＋ Crear outfit</button></div></div>
    {error && <p className="garment-notice" role="alert">{error}</p>}{message && <p className="garment-notice" role="status">{message}</p>}
    {!enabled && <div className="integration-note wide-note">Conecta Supabase para guardar outfits.</div>}
    {creating && <form className="upload-panel outfit-create-form studio-form" onSubmit={createOutfit}>
      <div className="studio-form-heading"><div><h2>Crear outfit</h2></div><button type="button" className="close-button" aria-label="Cerrar" onClick={() => setCreating(false)}>×</button></div>
      <div className="studio-fields"><label>Nombre del outfit<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required placeholder="Un nombre para tu look" /></label><label>Ocasión<input value={occasion} onChange={event => setOccasion(event.target.value)} maxLength={80} placeholder="Ocasión · opcional" /></label><label>Temporada<input value={season} onChange={event => setSeason(event.target.value)} maxLength={40} placeholder="Temporada · opcional" /></label><label>Nota personal<input value={description} onChange={event => setDescription(event.target.value)} maxLength={500} placeholder="Añade una nota · opcional" /></label></div>
      <div className="studio-layout">
        <section className="studio-preview" aria-label="Vista de la combinación"><div className="studio-preview-top"><span className="eyebrow">VISTA DEL LOOK</span><span>{selected.length} / 12 PIEZAS</span></div>{selectedGarments.length ? <div className="studio-selected-grid">{selectedGarments.map(item => <figure key={item.id}>{item.image_url ? <Image src={item.image_url} alt={item.name} fill unoptimized sizes="(max-width: 760px) 40vw, 230px" /> : <span className="studio-no-photo">{item.image_error ? 'Imagen temporalmente no disponible' : 'Sin fotografía'}</span>}<figcaption><b>{item.name}</b><small>{item.category}</small></figcaption></figure>)}</div> : <div className="studio-empty-state"><span>O</span><b>Selecciona prendas</b><small>Selecciona prendas del closet para verlas juntas.</small></div>}<div className="studio-preview-footer"><span>{selected.length ? 'SELECCIÓN ACTUAL' : 'ESTUDIO DE OUTFITS'}</span><span>{selected.length} {selected.length === 1 ? 'prenda' : 'prendas'}</span></div></section>
        <section className="studio-wardrobe"><div className="studio-wardrobe-heading"><div><span className="eyebrow">SELECCIONA TUS PRENDAS</span><h3>Closet</h3></div><span>{garments.length} PIEZAS</span></div><p>Selecciona de 1 a 12 prendas.</p><div className="garment-picker">{garments.map(item => <label key={item.id} className={`garment-pick ${selected.includes(item.id) ? 'selected' : ''}`}><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggleGarment(item.id)} />{item.image_url ? <Image src={item.image_url} alt="" fill unoptimized sizes="120px" /> : <span>{item.image_error ? 'Foto no disponible' : 'Sin foto'}</span>}<b>{item.name}</b><small>{item.category}</small><i aria-hidden="true">{selected.includes(item.id) ? '✓' : '+'}</i></label>)}</div><button className="primary-button studio-save" type="submit" disabled={busy || !name.trim() || !selected.length}>{busy ? 'Guardando combinación…' : 'Guardar outfit'} <span>→</span></button></section>
      </div>
    </form>}
    {!loading && outfits.length > 0 && featuredOutfit && <section className="outfit-featured-section"><div className="section-heading"><div><h2>{featuredOutfit.is_favorite ? 'Favorito' : 'Reciente'}</h2></div><span className="outfit-section-count">{featuredOutfit.items.length} PRENDAS</span></div><article className="outfit-featured-card"><div className="outfit-featured-art">{featuredOutfit.items.filter(item => item.image_url).slice(0, 4).map((item, index) => <div className={`outfit-feature-photo outfit-feature-photo-${index + 1}`} key={item.id}><Image src={item.image_url!} alt={`${item.name}, ${item.category}`} fill unoptimized sizes="(max-width: 760px) 42vw, 280px" /></div>)}{!featuredOutfit.items.some(item => item.image_url) && <div className="outfit-no-images"><span>O</span><small>FOTOGRAFÍAS NO DISPONIBLES</small></div>}<span className="outfit-art-caption">O-CLOÜD · LOOK {String(outfits.indexOf(featuredOutfit) + 1).padStart(2, '0')}</span></div><div className="outfit-featured-copy"><span className="editorial-kicker">{featuredOutfit.occasion || featuredOutfit.season || 'COMBINACIÓN PERSONAL'}</span><h3>{featuredOutfit.name}</h3>{featuredOutfit.description && <p>{featuredOutfit.description}</p>}<div className="outfit-featured-items">{featuredOutfit.items.map(item => <span key={item.id}>{item.name}<small>{item.category}</small></span>)}</div><div className="outfit-featured-actions"><button type="button" className="outfit-favorite" onClick={() => void toggleFavorite(featuredOutfit)} aria-label={featuredOutfit.is_favorite ? 'Quitar de favoritos' : 'Marcar favorito'}>{featuredOutfit.is_favorite ? '♥' : '♡'}</button><button type="button" className="text-button" onClick={() => void deleteOutfit(featuredOutfit)}>Eliminar outfit</button></div></div></article></section>}
    {!loading && otherFavorites.length > 0 && <section className="outfit-collection-section"><div className="section-heading"><div><h2>Favoritos</h2></div><span className="outfit-section-count">{otherFavorites.length} LOOKS</span></div><div className="outfit-collection-grid">{otherFavorites.map(outfit => <OutfitCard key={outfit.id} outfit={outfit} onFavorite={toggleFavorite} onDelete={deleteOutfit} />)}</div></section>}
    {!loading && recentOutfits.length > 0 && <section className="outfit-collection-section"><div className="section-heading"><div><h2>Otros looks</h2></div><span className="outfit-section-count">{recentOutfits.length} LOOKS</span></div><div className="outfit-collection-grid">{recentOutfits.map(outfit => <OutfitCard key={outfit.id} outfit={outfit} onFavorite={toggleFavorite} onDelete={deleteOutfit} />)}</div></section>}
    {loading && <div className="empty-closet"><p>Cargando tus outfits…</p></div>}
    {!loading && !outfits.length && !creating && <div className="outfit-empty-editorial"><div className="outfit-empty-art"><span>O</span><i/><b>LOOK 01</b></div><div><h2>{garments.length ? 'Crear un outfit.' : 'Primero, añade prendas a tu closet.'}</h2><button type="button" className="primary-button" onClick={() => setCreating(true)} disabled={!garments.length}>{garments.length ? 'Crear outfit' : 'Aún no hay prendas'} <span>↗</span></button></div></div>}
    <section className="outfit-stylist-section"><div className="section-heading"><div><h2>Estilista</h2></div></div><WeatherStylist enabled={enabled} /></section>
    <VirtualTryOn outfits={outfits} enabled={enabled} />
  </div>;
}

function OutfitCard({ outfit, onFavorite, onDelete }: { outfit: Outfit; onFavorite: (outfit: Outfit) => Promise<void>; onDelete: (outfit: Outfit) => Promise<void> }) {
  return <article className="outfit-collection-card"><div className="outfit-collection-art">{outfit.items.filter(item => item.image_url).slice(0, 3).map((item, index) => <div className={`outfit-collection-photo outfit-collection-photo-${index + 1}`} key={item.id}><Image src={item.image_url!} alt={`${item.name}, ${item.category}`} fill unoptimized sizes="(max-width: 760px) 40vw, 220px" /></div>)}{!outfit.items.some(item => item.image_url) && <div className="outfit-no-images"><span>O</span><small>FOTOGRAFÍAS NO DISPONIBLES</small></div>}<button type="button" className="outfit-favorite" onClick={() => void onFavorite(outfit)} aria-label={outfit.is_favorite ? 'Quitar de favoritos' : 'Marcar favorito'}>{outfit.is_favorite ? '♥' : '♡'}</button></div><div className="outfit-collection-copy"><span className="eyebrow">{outfit.occasion || outfit.season || 'OUTFIT PERSONAL'}</span><h3>{outfit.name}</h3><p>{outfit.items.length} {outfit.items.length === 1 ? 'prenda' : 'prendas'}{outfit.description ? ` · ${outfit.description}` : ''}</p><button type="button" className="text-button" onClick={() => void onDelete(outfit)}>Eliminar outfit</button></div></article>;
}



