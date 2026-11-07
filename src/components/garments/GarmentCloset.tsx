'use client';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hasTripoPollTimedOut, nextTripoPollDelay, TRIPO_INITIAL_POLL_DELAY_MS } from '@/lib/tripo/polling';
import { useSignedImageRenewal } from '@/lib/images/use-signed-image-renewal';

type Garment = {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  color: string | null;
  processing_status: string;
  is_favorite: boolean;
  image_url: string | null;
  image_error?: string | null;
  model_3d_path?: string | null;
};

const categories = ['Parte superior', 'Parte inferior', 'Prendas completas', 'Calzado', 'Accesorios', 'Ropa deportiva', 'Ropa de dormir', 'Ropa interior', 'Formal', 'Temporada'];
function hasSupportedImageSignature(bytes: Uint8Array) {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return jpeg || png || webp;
}

export default function GarmentCloset({ enabled, tripoAvailable = false, addRequest = 0 }: { enabled: boolean; tripoAvailable?: boolean; addRequest?: number }) {
  const router = useRouter();
  const [items, setItems] = useState<Garment[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [subcategory, setSubcategory] = useState('');
  const [color, setColor] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Todas');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState('recent');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', category: categories[0], subcategory: '', color: '' });
  const [modelState, setModelState] = useState<Record<string, { status: string; url?: string | null; progress?: number }>>({});
  const modelOperations = useRef(new Map<string, { requestId: string; startedAt: number; delay: number; timer: number | null; inFlight: boolean }>());
  const uploadRequestId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return false;
    setLoading(true);
    try {
      const response = await fetch('/api/garments', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudieron cargar las prendas.');
      setItems(result.garments);
      setLoadError('');
      return true;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar las prendas.');
      return false;
    } finally { setLoading(false); }
  }, [enabled]);

  useSignedImageRenewal(refresh, enabled);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (addRequest > 0) { setAdding(true); setNotice(''); }
  }, [addRequest]);
  useEffect(() => {
    if (!adding) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !busy) { setAdding(false); setFile(null); uploadRequestId.current = null; }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape); };
  }, [adding, busy]);
  useEffect(() => {
    items.filter(item => item.model_3d_path && !modelState[item.id]?.url).forEach(item => {
      void fetch(`/api/garments/${item.id}/model`, { cache: 'no-store' }).then(response => response.json()).then(result => {
        if (result.status === 'completed') setModelState(current => ({ ...current, [item.id]: result }));
      }).catch(() => undefined);
    });
  }, [items, modelState]);
  useEffect(() => () => {
    for (const operation of modelOperations.current.values()) if (operation.timer !== null) window.clearTimeout(operation.timer);
    modelOperations.current.clear();
  }, []);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const visibleItems = useMemo(() => items.filter(item =>
    (filter === 'Todas' || item.category === filter) &&
    (!favoritesOnly || item.is_favorite) &&
    `${item.name} ${item.category} ${item.subcategory || ''} ${item.color || ''}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))
  ).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'es') : 0), [items, filter, favoritesOnly, query, sort]);

  async function selectFile(candidate?: File) {
    if (!candidate) return;
    if (candidate.size <= 0 || candidate.size > 10 * 1024 * 1024) {
      setFile(null);
      setNotice('Elige una imagen JPG, PNG o WEBP de hasta 10 MB.');
      return;
    }

    const signature = new Uint8Array(await candidate.slice(0, 12).arrayBuffer());
    if (!hasSupportedImageSignature(signature)) {
      setFile(null);
      setNotice('El archivo no es una imagen JPEG, PNG o WEBP válida.');
      return;
    }
    setFile(candidate);
    uploadRequestId.current = crypto.randomUUID();
    if (!name) setName(candidate.name.replace(/\.[^.]+$/, '').slice(0, 100));
    setNotice('');
  }

  async function saveGarment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !enabled) return;
    setBusy(true); setNotice('');
    const data = new FormData();
    data.set('image', file); data.set('name', name); data.set('category', category);
    data.set('subcategory', subcategory); data.set('color', color);
    const requestId = uploadRequestId.current || crypto.randomUUID();
    uploadRequestId.current = requestId;
    data.set('processing_job_id', requestId);
    data.set('allow_paid', 'yes');
    try {
      const response = await fetch('/api/garments', { method: 'POST', body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo guardar la prenda.');
      setItems(current => [result.garment, ...current]);
      setAdding(false); setFile(null); setName(''); setSubcategory(''); setColor(''); uploadRequestId.current = null;
      setNotice([result.processing_warning, result.garment.image_error].filter(Boolean).join(' ') || (result.garment.processing_status === 'ready' ? 'Prenda procesada y guardada en tu Closet.' : 'Prenda guardada de forma privada.'));
      router.refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo guardar la prenda.'); }
    finally { setBusy(false); }
  }

  async function removeGarment(item: Garment) {
    if (!window.confirm(`¿Eliminar “${item.name}” de tu Closet?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/garments/${item.id}`, { method: 'DELETE' });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'No se pudo eliminar.'); }
      setItems(current => current.filter(candidate => candidate.id !== item.id));
      setNotice('Prenda eliminada.');
      router.refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo eliminar la prenda.'); }
    finally { setBusy(false); }
  }

  async function toggleFavorite(item: Garment) {
    try {
      const response = await fetch(`/api/garments/${item.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ is_favorite: !item.is_favorite }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo actualizar el favorito.');
      setItems(current => current.map(candidate => candidate.id === item.id ? { ...candidate, is_favorite: result.garment.is_favorite } : candidate));
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo actualizar el favorito.'); }
  }

  function beginEdit(item: Garment) {
    setEditingId(item.id);
    setEditDraft({ name: item.name, category: item.category, subcategory: item.subcategory || '', color: item.color || '' });
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/garments/${editingId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(editDraft) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo actualizar la prenda.');
      setItems(current => current.map(item => item.id === editingId ? { ...item, ...result.garment } : item));
      setEditingId(null); setNotice('Cambios guardados.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo actualizar la prenda.'); }
    finally { setBusy(false); }
  }

  async function modelAction(item: Garment, poll = false) {
    let operation = modelOperations.current.get(item.id);
    if (!operation) {
      operation = { requestId: crypto.randomUUID(), startedAt: Date.now(), delay: TRIPO_INITIAL_POLL_DELAY_MS, timer: null, inFlight: false };
      modelOperations.current.set(item.id, operation);
    }
    if (operation.inFlight) return;
    if (operation.timer !== null) { window.clearTimeout(operation.timer); operation.timer = null; }
    if (poll && modelState[item.id]?.status === 'paused') operation.startedAt = Date.now();
    operation.inFlight = true;
    setModelState(current => ({ ...current, [item.id]: { ...current[item.id], status: poll ? 'processing' : 'starting' } }));
    let httpStatus: number | null = null;
    try {
      const response = await fetch(`/api/garments/${item.id}/model`, { method: poll ? 'GET' : 'POST', headers: poll ? undefined : { 'content-type': 'application/json' }, body: poll ? undefined : JSON.stringify({ request_id: operation.requestId }), cache: 'no-store' });
      httpStatus = response.status;
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No se pudo generar el modelo.');
      if (modelOperations.current.get(item.id) !== operation) return;
      setModelState(current => ({ ...current, [item.id]: result }));
      if (result.status === 'processing') {
        if (hasTripoPollTimedOut(operation.startedAt)) {
          setModelState(current => ({ ...current, [item.id]: { ...result, status: 'paused' } }));
        } else {
          operation.timer = window.setTimeout(() => void modelAction(item, true), operation.delay);
          operation.delay = nextTripoPollDelay(operation.delay);
        }
      } else if (result.status === 'completed') {
        modelOperations.current.delete(item.id);
        setNotice('Estimación 3D guardada de forma privada.'); await refresh();
      } else if (result.status === 'failed' || result.status === 'cancelled') {
        modelOperations.current.delete(item.id);
      } else {
        setModelState(current => ({ ...current, [item.id]: { ...result, status: 'paused' } }));
      }
    } catch (error) {
      if (modelOperations.current.get(item.id) !== operation) return;
      if ([400, 401, 403, 404, 409, 429].includes(httpStatus || 0)) {
        modelOperations.current.delete(item.id);
        setModelState(current => ({ ...current, [item.id]: { status: 'failed' } }));
      } else {
        setModelState(current => ({ ...current, [item.id]: { ...current[item.id], status: 'paused' } }));
      }
      setNotice(error instanceof Error ? error.message : 'No se pudo consultar el modelo. Reanuda el seguimiento antes de iniciar otro.');
    } finally {
      operation.inFlight = false;
    }
  }

  return <div className="garment-closet">
    <div className="closet-masthead"><div><h1>Closet</h1></div><div className="closet-masthead-actions"><div className="closet-piece-count"><b>{items.length.toString().padStart(2, '0')}</b><span>PRENDAS</span></div><button className="primary-button" type="button" onClick={() => { setAdding(true); setNotice(''); }}>＋ Añadir prenda</button></div></div>
    {notice && <p className="garment-notice" role="status">{notice}</p>}
    {adding && <div className="garment-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) { setAdding(false); setFile(null); uploadRequestId.current = null; } }}>
      <form className="upload-panel garment-form garment-modal" role="dialog" aria-modal="true" aria-labelledby="garment-modal-title" onSubmit={saveGarment}>
        <div className="garment-modal-heading"><div><h2 id="garment-modal-title">Añadir prenda</h2></div><button className="close-button" type="button" aria-label="Cerrar formulario" onClick={() => { setAdding(false); setFile(null); uploadRequestId.current = null; }}>×</button></div>
        <p className="muted">La foto se guarda en almacenamiento privado.</p>
        {notice && <p className="garment-notice" role="alert">{notice}</p>}
        <label className={`upload-drop ${preview ? 'has-photo' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); selectFile(event.dataTransfer.files[0]); }}>
          {preview ? <Image src={preview} alt="Vista previa de la prenda" width={320} height={220} unoptimized /> : <><span className="upload-icon">↥</span><b>Arrastra tu imagen aquí</b><span>o elige una desde tu dispositivo</span></>}
          <input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={event => { void selectFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
        </label>
        <div className="garment-fields"><label>Nombre<input value={name} onChange={event => { uploadRequestId.current = null; setName(event.target.value); }} maxLength={100} required /></label><label>Categoría<select value={category} onChange={event => { uploadRequestId.current = null; setCategory(event.target.value); }}>{categories.map(value => <option key={value}>{value}</option>)}</select></label><label>Subcategoría<input value={subcategory} onChange={event => { uploadRequestId.current = null; setSubcategory(event.target.value); }} maxLength={80} placeholder="Opcional" /></label><label>Color<input value={color} onChange={event => { uploadRequestId.current = null; setColor(event.target.value); }} maxLength={60} placeholder="Opcional" /></label></div>
        <div className="upload-actions"><span>JPG, PNG o WEBP · Máximo 10 MB</span><button className="primary-button" type="submit" disabled={!file || !name.trim() || busy || !enabled}>{busy ? 'Procesando y guardando…' : 'Guardar prenda'}</button></div>
        {!enabled && <div className="integration-note">Conecta Supabase para guardar prendas en tu cuenta. Esta vista previa no persiste.</div>}
      </form>
    </div>}
    <div className="closet-toolbar"><div className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Buscar prendas" placeholder="Busca por prenda, categoría o color" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="closet-toolbar-options"><select className="filter-select" aria-label="Ordenar prendas" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Más recientes</option><option value="name">Orden alfabético</option></select><button type="button" className={`filter-button ${favoritesOnly ? 'selected' : ''}`} onClick={() => setFavoritesOnly(value => !value)}>♡ Favoritos</button></div></div>
    <div className="closet-category-rail" aria-label="Categorías de prendas"><button type="button" className={filter === 'Todas' ? 'selected' : ''} onClick={() => setFilter('Todas')}>Todas <span>{items.length}</span></button>{categories.map(value => { const count = items.filter(item => item.category === value).length; return <button type="button" key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{value}<span>{count}</span></button>; })}</div>
    {!enabled && <div className="integration-note wide-note">Conecta Supabase para guardar prendas.</div>}
    {loadError && <div className="integration-note wide-note" role="alert">{loadError} <button className="text-button" onClick={() => void refresh()}>Reintentar ↻</button></div>}
    {loading ? <div className="empty-closet"><p>Cargando tu guardarropa…</p></div> : visibleItems.length ? <div className="garment-grid">{visibleItems.map((item, index) => { const model = modelState[item.id]; return <article className={`garment-card ${index === 0 ? 'garment-feature' : ''}`} key={item.id}><div className="garment-image">{item.image_url ? <Image src={item.image_url} alt={item.name} fill unoptimized sizes="(max-width: 700px) 50vw, 320px" /> : <span>{item.image_error || 'Imagen privada no disponible'}</span>}<div className="garment-image-actions"><button className="garment-favorite" type="button" onClick={() => void toggleFavorite(item)} aria-label={item.is_favorite ? `Quitar ${item.name} de favoritos` : `Marcar ${item.name} como favorito`}>{item.is_favorite ? '♥' : '♡'}</button><button className="garment-delete" type="button" onClick={() => void removeGarment(item)} disabled={busy} aria-label={`Eliminar ${item.name}`}>×</button></div><div className="garment-image-caption"><span>{item.category}</span><b>{item.name}</b></div></div><div className="garment-meta"><div className="garment-meta-detail"><span>{[item.subcategory, item.color].filter(Boolean).join(' · ') || 'Prenda'}</span><small className="garment-processing-state">{item.processing_status === 'ready' ? 'Procesada' : 'Original'}</small></div><button type="button" className="text-button garment-edit-trigger" onClick={() => beginEdit(item)}>Editar <span>↗</span></button>{editingId === item.id && <form className="garment-edit-form" onSubmit={saveEdit}><label>Nombre<input value={editDraft.name} onChange={event => setEditDraft(value => ({ ...value, name: event.target.value }))} maxLength={100} required /></label><label>Categoría<select value={editDraft.category} onChange={event => setEditDraft(value => ({ ...value, category: event.target.value }))}>{categories.map(value => <option key={value}>{value}</option>)}</select></label><label>Subcategoría<input value={editDraft.subcategory} onChange={event => setEditDraft(value => ({ ...value, subcategory: event.target.value }))} maxLength={80} /></label><label>Color<input value={editDraft.color} onChange={event => setEditDraft(value => ({ ...value, color: event.target.value }))} maxLength={60} /></label><div><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button><button className="text-button" type="button" onClick={() => setEditingId(null)}>Cancelar</button></div></form>}<div className="model-3d"><b>ESTIMACIÓN 3D</b>{item.model_3d_path || model?.status === 'completed' ? <a href={model?.url || undefined} target="_blank" rel="noreferrer">Abrir GLB privado ↗</a> : tripoAvailable ? <><button type="button" className="text-button model-generate-button" disabled={!enabled || ['starting','processing'].includes(model?.status || '')} onClick={() => void modelAction(item, model?.status === 'paused')}>{model?.status === 'processing' ? `Generando ${model.progress || 0}%…` : model?.status === 'paused' ? 'Reanudar 3D' : model?.status === 'failed' ? 'Reintentar' : 'Generar 3D'}</button></> : <small>La generación 3D no está disponible por ahora. </small>}<small>Reconstrucción aproximada desde una vista. No es escaneo 360° ni geometría exacta.</small></div></div></article>; })}</div> : <div className="empty-closet closet-empty-editorial"><div className="empty-art"><div className="hanger">⌁</div><div className="empty-frame"><span>✳</span><small>PRENDAS</small></div><div className="empty-shadow"/></div><div><h2>{items.length ? 'No encontramos prendas con esos filtros.' : 'Sin prendas'}</h2><p>{items.length ? 'Prueba otra búsqueda o categoría.' : ''}</p>{!items.length && <button className="primary-button" onClick={() => setAdding(true)}>Añadir prenda <span>＋</span></button>}</div></div>}
  </div>;
}

