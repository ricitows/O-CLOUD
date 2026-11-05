'use client';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Garment = {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  color: string | null;
  processing_status: string;
  is_favorite: boolean;
  image_url: string | null;
  model_3d_path?: string | null;
};

const categories = ['Parte superior', 'Parte inferior', 'Prendas completas', 'Calzado', 'Accesorios', 'Ropa deportiva', 'Ropa de dormir', 'Ropa interior', 'Formal', 'Temporada'];
function hasSupportedImageSignature(bytes: Uint8Array) {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return jpeg || png || webp;
}

export default function GarmentCloset({ enabled, processorAvailable, tripoAvailable = false, addRequest = 0 }: { enabled: boolean; processorAvailable: boolean; tripoAvailable?: boolean; addRequest?: number }) {
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
  const [allowClipdrop, setAllowClipdrop] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Todas');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState('recent');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', category: categories[0], subcategory: '', color: '' });
  const [modelState, setModelState] = useState<Record<string, { status: string; url?: string | null; progress?: number }>>({});
  const [modelAuthorization, setModelAuthorization] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const response = await fetch('/api/garments', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudieron cargar las prendas.');
      setItems(result.garments);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar las prendas.');
    } finally { setLoading(false); }
  }, [enabled]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (addRequest > 0) { setAdding(true); setNotice(''); }
  }, [addRequest]);
  useEffect(() => {
    if (!adding) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { setAdding(false); setFile(null); }
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
    if (allowClipdrop) data.set('allow_paid_processing', 'yes');
    try {
      const response = await fetch('/api/garments', { method: 'POST', body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo guardar la prenda.');
      setItems(current => [result.garment, ...current]);
      setAdding(false); setFile(null); setName(''); setSubcategory(''); setColor(''); setAllowClipdrop(false);
      setNotice(result.processing_warning || (result.garment.processing_status === 'ready' ? 'Prenda procesada y guardada en tu Closet.' : 'Prenda original guardada de forma privada. No se llamó a Clipdrop.'));
      router.refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo guardar la prenda.'); }
    finally { setBusy(false); setAllowClipdrop(false); }
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
    setModelState(current => ({ ...current, [item.id]: { ...current[item.id], status: poll ? 'processing' : 'starting' } }));
    try {
      const response = await fetch(`/api/garments/${item.id}/model`, { method: poll ? 'GET' : 'POST', headers: poll ? undefined : { 'content-type': 'application/json' }, body: poll ? undefined : JSON.stringify({ allow_paid: true }), cache: 'no-store' });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No se pudo generar el modelo.');
      setModelState(current => ({ ...current, [item.id]: result }));
      if (result.status === 'failed' || result.status === 'completed') setModelAuthorization(current => ({ ...current, [item.id]: false }));
      if (result.status === 'processing') window.setTimeout(() => void modelAction(item, true), 4000);
      if (result.status === 'completed') { setNotice('Estimación 3D guardada de forma privada.'); await refresh(); }
    } catch (error) { setModelState(current => ({ ...current, [item.id]: { status: 'failed' } })); setModelAuthorization(current => ({ ...current, [item.id]: false })); setNotice(error instanceof Error ? error.message : 'No se pudo generar el modelo.'); }
  }

  return <div className="garment-closet">
    <div className="closet-masthead"><div><h1>Closet</h1></div><div className="closet-masthead-actions"><div className="closet-piece-count"><b>{items.length.toString().padStart(2, '0')}</b><span>PRENDAS</span></div><button className="primary-button" type="button" onClick={() => { setAdding(true); setNotice(''); }}>＋ Añadir prenda</button></div></div>
    {notice && <p className="garment-notice" role="status">{notice}</p>}
    {adding && <div className="garment-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) { setAdding(false); setFile(null); } }}>
      <form className="upload-panel garment-form garment-modal" role="dialog" aria-modal="true" aria-labelledby="garment-modal-title" onSubmit={saveGarment}>
        <div className="garment-modal-heading"><div><h2 id="garment-modal-title">Añadir prenda</h2></div><button className="close-button" type="button" aria-label="Cerrar formulario" onClick={() => { setAdding(false); setFile(null); }}>×</button></div>
        <p className="muted">La foto se guarda en almacenamiento privado. El procesamiento externo es opcional.</p>
        {notice && <p className="garment-notice" role="alert">{notice}</p>}
        {processorAvailable ? <label className="paid-opt-in"><input type="checkbox" checked={allowClipdrop} onChange={event => setAllowClipdrop(event.target.checked)} />Procesar con Clipdrop. Autorizo esta llamada, que puede consumir créditos o generar cargos.</label> : <div className="integration-note">Clipdrop es opcional; configura `CLIPDROP_API_KEY` en Supabase → Edge Functions → Secrets. Guardar prendas seguirá disponible con la foto original.</div>}
        <label className={`upload-drop ${preview ? 'has-photo' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); selectFile(event.dataTransfer.files[0]); }}>
          {preview ? <Image src={preview} alt="Vista previa de la prenda" width={320} height={220} unoptimized /> : <><span className="upload-icon">↥</span><b>Arrastra tu imagen aquí</b><span>o elige una desde tu dispositivo</span></>}
          <input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={event => { void selectFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
        </label>
        <div className="garment-fields"><label>Nombre<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required /></label><label>Categoría<select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label><label>Subcategoría<input value={subcategory} onChange={event => setSubcategory(event.target.value)} maxLength={80} placeholder="Opcional" /></label><label>Color<input value={color} onChange={event => setColor(event.target.value)} maxLength={60} placeholder="Opcional" /></label></div>
        <div className="upload-actions"><span>JPG, PNG o WEBP · Máximo 10 MB</span><button className="primary-button" type="submit" disabled={!file || !name.trim() || busy || !enabled}>{busy ? 'Guardando…' : 'Guardar prenda　→'}</button></div>
        {!enabled && <div className="integration-note">Conecta Supabase para guardar prendas en tu cuenta. Esta vista previa no persiste.</div>}
      </form>
    </div>}
    <div className="closet-toolbar"><div className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Buscar prendas" placeholder="Busca por prenda, categoría o color" value={query} onChange={event => setQuery(event.target.value)} /></div><div className="closet-toolbar-options"><select className="filter-select" aria-label="Ordenar prendas" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Más recientes</option><option value="name">Orden alfabético</option></select><button type="button" className={`filter-button ${favoritesOnly ? 'selected' : ''}`} onClick={() => setFavoritesOnly(value => !value)}>♡ Favoritos</button></div></div>
    <div className="closet-category-rail" aria-label="Categorías de prendas"><button type="button" className={filter === 'Todas' ? 'selected' : ''} onClick={() => setFilter('Todas')}>Todas <span>{items.length}</span></button>{categories.map(value => { const count = items.filter(item => item.category === value).length; return <button type="button" key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{value}<span>{count}</span></button>; })}</div>
    {!enabled && <div className="integration-note wide-note">Conecta Supabase para guardar prendas.</div>}
    {loadError && <div className="integration-note wide-note" role="alert">{loadError} <button className="text-button" onClick={() => void refresh()}>Reintentar ↻</button></div>}
    {loading ? <div className="empty-closet"><p>Cargando tu guardarropa…</p></div> : visibleItems.length ? <div className="garment-grid">{visibleItems.map((item, index) => { const model = modelState[item.id]; return <article className={`garment-card ${index === 0 ? 'garment-feature' : ''}`} key={item.id}><div className="garment-image">{item.image_url ? <Image src={item.image_url} alt={item.name} fill unoptimized sizes="(max-width: 700px) 50vw, 320px" /> : <span>Imagen privada no disponible</span>}<div className="garment-image-actions"><button className="garment-favorite" type="button" onClick={() => void toggleFavorite(item)} aria-label={item.is_favorite ? `Quitar ${item.name} de favoritos` : `Marcar ${item.name} como favorito`}>{item.is_favorite ? '♥' : '♡'}</button><button className="garment-delete" type="button" onClick={() => void removeGarment(item)} disabled={busy} aria-label={`Eliminar ${item.name}`}>×</button></div><div className="garment-image-caption"><span>{item.category}</span><b>{item.name}</b></div></div><div className="garment-meta"><div className="garment-meta-detail"><span>{[item.subcategory, item.color].filter(Boolean).join(' · ') || 'Prenda'}</span><small className="garment-processing-state">{item.processing_status === 'ready' ? 'Procesada' : 'Original'}</small></div><button type="button" className="text-button garment-edit-trigger" onClick={() => beginEdit(item)}>Editar <span>↗</span></button>{editingId === item.id && <form className="garment-edit-form" onSubmit={saveEdit}><label>Nombre<input value={editDraft.name} onChange={event => setEditDraft(value => ({ ...value, name: event.target.value }))} maxLength={100} required /></label><label>Categoría<select value={editDraft.category} onChange={event => setEditDraft(value => ({ ...value, category: event.target.value }))}>{categories.map(value => <option key={value}>{value}</option>)}</select></label><label>Subcategoría<input value={editDraft.subcategory} onChange={event => setEditDraft(value => ({ ...value, subcategory: event.target.value }))} maxLength={80} /></label><label>Color<input value={editDraft.color} onChange={event => setEditDraft(value => ({ ...value, color: event.target.value }))} maxLength={60} /></label><div><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button><button className="text-button" type="button" onClick={() => setEditingId(null)}>Cancelar</button></div></form>}<div className="model-3d"><b>ESTIMACIÓN 3D</b>{item.model_3d_path || model?.status === 'completed' ? <a href={model?.url || undefined} target="_blank" rel="noreferrer">Abrir GLB privado ↗</a> : tripoAvailable ? <details className="advanced-settings model-authorization"><summary>Generar modelo 3D</summary><label className="paid-opt-in compact-paid-opt-in"><input type="checkbox" checked={Boolean(modelAuthorization[item.id])} onChange={event => setModelAuthorization(current => ({ ...current, [item.id]: event.target.checked }))} />Autorizo enviar esta foto a Tripo. Puede generar cargos.</label><button type="button" className="text-button" disabled={!enabled || !modelAuthorization[item.id] || ['starting','processing'].includes(model?.status || '')} onClick={() => void modelAction(item)}>{model?.status === 'processing' ? `Generando ${model.progress || 0}%…` : model?.status === 'failed' ? 'Reintentar generación ↻' : 'Generar desde esta foto ↗'}</button></details> : <small>Tripo es opcional; no hay clave configurada. </small>}<small>Reconstrucción aproximada desde una vista. No es escaneo 360° ni geometría exacta.</small></div></div></article>; })}</div> : <div className="empty-closet closet-empty-editorial"><div className="empty-art"><div className="hanger">⌁</div><div className="empty-frame"><span>✳</span><small>PRENDAS</small></div><div className="empty-shadow"/></div><div><h2>{items.length ? 'No encontramos prendas con esos filtros.' : 'Sin prendas'}</h2><p>{items.length ? 'Prueba otra búsqueda o categoría.' : ''}</p>{!items.length && <button className="primary-button" onClick={() => setAdding(true)}>Añadir prenda <span>＋</span></button>}</div></div>}
  </div>;
}

