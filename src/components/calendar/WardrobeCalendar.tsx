'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type OutfitOption = { id: string; name: string; occasion: string | null };
type Assignment = { id: string; outfit_id: string; outfit_date: string; notes: string | null; outfits: { id: string; name: string; occasion: string | null } };
const weekDays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export default function WardrobeCalendar({ enabled }: { enabled: boolean }) {
  const [view, setView] = useState<'Mes' | 'Semana'>('Mes');
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const [selected, setSelected] = useState(() => new Date());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [outfits, setOutfits] = useState<OutfitOption[]>([]);
  const [outfitId, setOutfitId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const monthName = useMemo(() => new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(month), [month]);
  const startOfGrid = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    return new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  }, [month]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true); setError('');
    const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
    const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - offset);
    const from = iso(gridStart);
    const to = iso(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 41));
    try {
      const [calendarResponse, outfitsResponse] = await Promise.all([
        fetch(`/api/calendar?from=${from}&to=${to}`, { cache: 'no-store' }),
        fetch('/api/outfits', { cache: 'no-store' }),
      ]);
      const calendarBody = await calendarResponse.json();
      const outfitBody = await outfitsResponse.json();
      if (!calendarResponse.ok) throw new Error(calendarBody.error || 'No se pudo cargar el calendario.');
      if (!outfitsResponse.ok) throw new Error(outfitBody.error || 'No se pudieron cargar tus outfits.');
      setAssignments(calendarBody.assignments);
      setOutfits(outfitBody.outfits.map((outfit: OutfitOption) => ({ id: outfit.id, name: outfit.name, occasion: outfit.occasion })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el calendario.'); }
    finally { setLoading(false); }
  }, [enabled, month]);

  useEffect(() => { void refresh(); }, [refresh]);
  const byDate = useMemo(() => new Map(assignments.map(item => [item.outfit_date, item])), [assignments]);
  const selectedIso = iso(selected);
  const selectedAssignment = byDate.get(selectedIso);
  useEffect(() => {
    setOutfitId(selectedAssignment?.outfit_id || '');
    setNotes(selectedAssignment?.notes || '');
  }, [selectedAssignment?.id, selectedAssignment?.outfit_id, selectedAssignment?.notes, selectedIso]);

  const days = useMemo(() => {
    if (view === 'Semana') {
      const first = new Date(selected);
      first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
      return Array.from({ length: 7 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
    }
    return Array.from({ length: 42 }, (_, i) => new Date(startOfGrid.getFullYear(), startOfGrid.getMonth(), startOfGrid.getDate() + i));
  }, [view, selected, startOfGrid]);

  function shiftMonth(amount: number) {
    const target = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    setMonth(target);
    setSelected(new Date(target.getFullYear(), target.getMonth(), Math.min(selected.getDate(), lastDay)));
  }

  async function saveAssignment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || !outfitId) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/calendar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: selectedIso, outfit_id: outfitId, notes }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo guardar el outfit.');
      setMessage('Outfit guardado en el calendario.'); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el outfit.'); }
    finally { setSaving(false); }
  }

  async function removeAssignment() {
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/calendar?date=${selectedIso}`, { method: 'DELETE' });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || 'No se pudo quitar la asignación.'); }
      setMessage('Asignación eliminada.'); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo quitar la asignación.'); }
    finally { setSaving(false); }
  }

  return <section className="panel calendar-panel"><div className="panel-heading"><div><div className="eyebrow">PLANIFICA CON INTENCIÓN</div><h2>Tu calendario</h2></div><div className="calendar-controls"><div className="segmented"><button className={view === 'Mes' ? 'selected' : ''} onClick={() => setView('Mes')}>Mes</button><button className={view === 'Semana' ? 'selected' : ''} onClick={() => setView('Semana')}>Semana</button></div><button className="arrow-button" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">‹</button><button className="arrow-button" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">›</button></div></div>
      <div className="month-line"><b>{monthName}</b><span>{loading ? 'Cargando…' : enabled ? `${assignments.length} outfits planificados` : 'Conecta tu cuenta para guardar outfits'}</span></div>
      <div className={`calendar-grid ${view === 'Semana' ? 'week-view' : ''}`}>{weekDays.map(day => <div className="day-label" key={day}>{day}</div>)}{days.map(date => {
        const dateKey = iso(date); const assignment = byDate.get(dateKey); const inMonth = date.getMonth() === month.getMonth(); const today = dateKey === iso(new Date());
        return <button key={dateKey} disabled={!inMonth && view === 'Mes'} onClick={() => setSelected(date)} className={`day-cell ${!inMonth && view === 'Mes' ? 'blank' : ''} ${dateKey === selectedIso ? 'chosen' : ''} ${today ? 'today' : ''} ${assignment ? 'has-assignment' : ''}`} aria-label={`${date.getDate()} ${assignment ? `, ${assignment.outfits.name}` : ''}`} title={assignment?.outfits.name}>{date.getDate()}{assignment && <small>{assignment.outfits.name}</small>}{today && <i/>}</button>;
      })}</div>
      <div className="calendar-foot"><span className="legend-dot"/>Día seleccionado <span className="calendar-hint">{new Intl.DateTimeFormat('es-MX', { dateStyle: 'long' }).format(selected)}</span></div>
      {enabled && <form className="calendar-assignment" onSubmit={saveAssignment}><div><div className="eyebrow">{selectedAssignment ? 'OUTFIT PROGRAMADO' : 'PLAN PARA ESTE DÍA'}</div><b>{selectedAssignment?.outfits.name || 'Elige un outfit guardado'}</b></div><label>Outfit<select value={outfitId} onChange={event => setOutfitId(event.target.value)} required><option value="">Seleccionar outfit…</option>{outfits.map(outfit => <option key={outfit.id} value={outfit.id}>{outfit.name}{outfit.occasion ? ` · ${outfit.occasion}` : ''}</option>)}</select></label><label>Notas<input value={notes} onChange={event => setNotes(event.target.value)} maxLength={500} placeholder="Evento u ocasión (opcional)" /></label><div className="calendar-assignment-actions"><button className="primary-button" type="submit" disabled={saving || !outfitId || !outfits.length}>{saving ? 'Guardando…' : selectedAssignment ? 'Actualizar' : 'Asignar outfit'}</button>{selectedAssignment && <button className="text-button" type="button" onClick={() => void removeAssignment()} disabled={saving}>Quitar</button>}</div></form>}
      {error && <p className="garment-notice" role="alert">{error} <button className="text-button" onClick={() => void refresh()}>Reintentar</button></p>}{message && <p className="garment-notice" role="status">{message}</p>}
    </section>;
}
