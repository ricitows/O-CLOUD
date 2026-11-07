'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

type Garment = { id: string; name: string; category: string; image_url: string | null };
type Outfit = { id: string; name: string; items: Garment[] };
type CollageMode = 'final' | 'diagnostic';

export default function VirtualTryOn({ outfits, enabled }: { outfits: Outfit[]; enabled: boolean }) {
  const [outfitId, setOutfitId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewMode, setPreviewMode] = useState<CollageMode | null>(null);
  const [previewHeight, setPreviewHeight] = useState(1600);
  const collageRequest = useRef<{ key: string; id: string } | null>(null);
  const outfit = outfits.find(item => item.id === outfitId);
  const missingPhotos = Boolean(outfit?.items.some(item => !item.image_url));
  const canCreate = Boolean(enabled && outfit?.items.length && !missingPhotos && !busy);
  const canDiagnose = Boolean(enabled && outfit?.items.length && !missingPhotos && !busy);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  function selectOutfit(id: string) {
    collageRequest.current = null;
    setOutfitId(id);
    setPreviewUrl('');
    setPreviewMode(null);
    setError('');
    setMessage('');
  }

  async function createCollage(mode: CollageMode = 'final') {
    if (!outfitId || (mode === 'final' ? !canCreate : !canDiagnose)) return;
    setBusy(true); setError(''); setMessage(''); setPreviewUrl('');
    setPreviewMode(null);
    try {
      const key = outfitId + ':' + mode;
      if (!collageRequest.current || collageRequest.current.key !== key) collageRequest.current = { key, id: crypto.randomUUID() };
      const response = await fetch('/api/collage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outfit_id: outfitId, request_id: collageRequest.current.id, diagnostic_mode: mode === 'diagnostic' }),
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo crear la composición.');
      }
      const blob = await response.blob();
      if (!blob.size || !blob.type.toLowerCase().includes('image/png')) throw new Error('El servidor no devolvió una imagen PNG válida con contenido. Puedes reintentar.');
      const returnedMode = response.headers.get('X-Collage-Mode');
      if (returnedMode !== mode) throw new Error('El servidor devolvió un modo de composición distinto al solicitado. No se mostró la imagen.');
      const height = Number(response.headers.get('X-Image-Height'));
      if (Number.isFinite(height) && height > 0) setPreviewHeight(height);
      setPreviewUrl(URL.createObjectURL(blob));
      setPreviewMode(mode);
      collageRequest.current = null;
      setMessage(mode === 'diagnostic'
        ? 'Prueba gratuita de composición lista. Conserva los fondos originales y no es el resultado final.'
        : 'Tu composición está lista para revisar y descargar.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ocurrió un error al crear la composición.');
    } finally { setBusy(false); }
  }

  function downloadCollage() {
    if (!previewUrl) return;
    const safeName = (outfit?.name || 'mi-outfit').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'mi-outfit';
    const link = document.createElement('a'); link.href = previewUrl; link.download = `${safeName}-composicion.png`;
    document.body.appendChild(link); link.click(); link.remove();
  }

  return (
    <section className="virtual-try-on collage-panel" aria-labelledby="collage-title">
      <header className="collage-heading">
        <h2 id="collage-title">Tu outfit, en una composición</h2>
        <p>Une las prendas de tu outfit en una sola lámina editorial, usando las fotografías guardadas en tu Closet.</p>
      </header>

      {!enabled && <div className="collage-notice" role="status">Conecta Supabase para consultar tus outfits y sus fotografías privadas.</div>}
      {enabled && outfits.length === 0 && <div className="collage-empty"><span className="collage-index">01 / OUTFITS</span><h3>Primero guarda una combinación</h3><p>En la sección Outfits, elige prendas de tu Closet y guarda un conjunto. Después aparecerá aquí.</p></div>}

      {outfits.length > 0 && <div className="collage-workspace">
        <div className="collage-controls">
          <label className="collage-select" htmlFor="collage-outfit">Elige un outfit guardado
            <select id="collage-outfit" value={outfitId} onChange={event => selectOutfit(event.target.value)} disabled={!enabled || busy}>
              <option value="">Seleccionar outfit</option>
              {outfits.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {outfit && <div className="collage-summary"><div className="collage-summary-title"><span>SELECCIÓN</span><b>{outfit.name}</b><small>{outfit.items.length} {outfit.items.length === 1 ? 'prenda' : 'prendas'}</small></div>
            <div className="collage-garments" aria-label="Prendas incluidas">
              {outfit.items.map(item => <div className="collage-garment" key={item.id} title={`${item.name} · ${item.category}`}>
                {item.image_url ? <Image src={item.image_url} alt={item.name} width={72} height={82} unoptimized /> : <span className="collage-no-image">Sin foto</span>}
                <span>{item.name}</span>
              </div>)}
            </div>
          </div>}
          {missingPhotos && <p className="collage-notice" role="alert">Falta una fotografía accesible. Revisa las imágenes de este outfit en tu Closet; no se sustituirá ninguna prenda.</p>}
          {error && <p className="collage-notice" role="alert">{error}</p>}
          {message && <p className="collage-success" role="status">{message}</p>}
          <div className="collage-actions">
            <button className="primary-button" type="button" onClick={() => void createCollage('final')} disabled={!canCreate}>
              {busy && previewMode !== 'diagnostic' ? <><span className="collage-spinner" aria-hidden="true" /> Preparando tu composición…</> : previewUrl ? 'Actualizar composición' : 'Crear collage'}
            </button>
            <button className="collage-download" type="button" onClick={() => void createCollage('diagnostic')} disabled={!canDiagnose}>Vista gratuita con fondos originales</button>
            {previewUrl && <button className="collage-download" type="button" onClick={downloadCollage}>Descargar PNG ↓</button>}
          </div>
        </div>

        <div className={`collage-artboard ${previewUrl ? 'has-preview' : ''}`} aria-live="polite">
          <div className="collage-artboard-label"><span>{previewMode === 'diagnostic' ? 'DIAGNÓSTICO · FONDOS ORIGINALES' : 'VISTA PREVIA'}</span><span>{previewUrl ? `PNG · 1200 × ${previewHeight}` : 'LÁMINA EDITORIAL'}</span></div>
          {previewUrl ? <Image src={previewUrl} alt={`Composición del outfit ${outfit?.name || ''}`} width={1200} height={previewHeight} unoptimized /> :
            <div className="collage-placeholder"><span className="collage-placeholder-mark">O</span><b>{busy ? 'Acomodando tus prendas' : outfit ? 'Tu composición aparecerá aquí' : 'Elige un outfit para comenzar'}</b><small>Fondo blanco · prendas recortadas · una sola imagen</small></div>}
        </div>
      </div>}
    </section>
  );
}
