'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { signOut, updateProfile } from '@/app/auth/actions';
import { AuthNotice } from '@/components/auth/AuthShell';
import GarmentCloset from '@/components/garments/GarmentCloset';
import WardrobeCalendar from '@/components/calendar/WardrobeCalendar';
import OutfitStudio from '@/components/outfits/OutfitStudio';
import WeatherStylist from '@/components/stylist/WeatherStylist';

type Section = 'Inicio' | 'Closet' | 'Outfits' | 'Perfil';
type OutfitPreviewItem = { id: string; name: string; category: string; image_url: string | null };
type FeaturedOutfit = { id: string; name: string; occasion: string | null; season: string | null; description: string | null; is_favorite: boolean; items: OutfitPreviewItem[] };
type RecentOutfit = FeaturedOutfit;
const nav: { name: Section; icon: string }[] = [
  { name: 'Inicio', icon: '⌂' }, { name: 'Closet', icon: '▤' }, { name: 'Outfits', icon: '◈' }, { name: 'Perfil', icon: '○' },
];

function Mark({ light = false }: { light?: boolean }) {
  return <div className={`brand ${light ? 'brand-light' : ''}`}><span>O-CLOÜD</span></div>;
}

export default function Dashboard({ displayName = '', username = '', avatarUrl = '', email = '', garmentCount = 0, outfitCount = 0, nextOutfit, featuredOutfit, recentOutfits = [], supabaseConfigured = false, processorAvailable = false, tripoAvailable = false, authError, authNotice }: { displayName?: string; username?: string; avatarUrl?: string; email?: string; garmentCount?: number; outfitCount?: number; nextOutfit?: { name: string; date: string }; featuredOutfit?: FeaturedOutfit; recentOutfits?: RecentOutfit[]; supabaseConfigured?: boolean; processorAvailable?: boolean; tripoAvailable?: boolean; authError?: string; authNotice?: string }) {
  const [section, setSection] = useState<Section>('Inicio');
  const [toast, setToast] = useState('');
  const [addRequest, setAddRequest] = useState(0);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); }, [avatarPreview]);
  const todayLabel = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const firstName = displayName.trim().split(/\s+/)[0];
  const heroImages = (featuredOutfit?.items ?? []).filter(item => item.image_url).slice(0, 3);

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3000); };
  const openAddClothing = () => { setSection('Closet'); setAddRequest(value => value + 1); };

  return <main className="app-shell phase-two">
    <aside className="sidebar">
      <Mark />
      <nav aria-label="Navegación principal">{nav.map(item => <button type="button" key={item.name} aria-current={section === item.name ? 'page' : undefined} className={`nav-item ${section === item.name ? 'active' : ''}`} onClick={() => setSection(item.name)}><span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.name}{item.name === 'Closet' && <span className="nav-count">{garmentCount}</span>}</button>)}</nav>
      <button className="sidebar-add" type="button" onClick={openAddClothing}><span>＋</span><span><b>Añadir prenda</b></span><i>↗</i></button>
      <div className="sidebar-bottom"><div className="side-divider"/><div className="weather-mini"><span className="sun" aria-hidden="true">☼</span><div><b>Estilista</b></div></div><button type="button" className="side-user" onClick={() => setSection('Perfil')}><span className="avatar">{(avatarPreview || avatarUrl) ? <Image src={avatarPreview || avatarUrl} alt="" width={31} height={31} unoptimized /> : displayName.slice(0, 1).toUpperCase() || 'O'}</span><span className="side-user-copy"><b>{username ? `@${username}` : 'Perfil'}</b><small>{email || 'Privado'}</small></span><span className="dots" aria-hidden="true">↗</span></button></div>
    </aside>
    <div className="mobile-top"><Mark /></div>
    <section className="main-area">
      <header className="topbar"><div className="breadcrumb"><b>{section}</b></div><div className="top-actions"><button type="button" aria-label="Notificaciones" className="icon-button" onClick={() => notify('No tienes notificaciones nuevas.')}>♧</button><button type="button" aria-label="Abrir perfil" className="avatar small-avatar" onClick={() => setSection('Perfil')}>{(avatarPreview || avatarUrl) ? <Image src={avatarPreview || avatarUrl} alt="" width={29} height={29} unoptimized /> : displayName.slice(0, 1).toUpperCase() || 'O'}</button></div></header>
      {section === 'Inicio' && <div className="content dashboard home-editorial">
        <header className="home-greeting"><div><div className="eyebrow">{todayLabel}</div><h1>{firstName ? <>Hola, <em>{firstName}.</em></> : <>Inicio</>}</h1></div><button className="mobile-profile-shortcut" type="button" aria-label="Abrir perfil" onClick={() => setSection('Perfil')}>{(avatarPreview || avatarUrl) ? <Image src={avatarPreview || avatarUrl} alt="" width={32} height={32} unoptimized /> : displayName.slice(0, 1).toUpperCase() || 'O'}<span>Perfil</span></button></header>

        <section className="home-spotlight" aria-labelledby="home-spotlight-title">
          <div className="home-spotlight-photos" aria-label={heroImages.length ? `Prendas de ${featuredOutfit?.name}` : 'Vista editorial del armario'}>
            {heroImages.length ? heroImages.map((item, index) => <div className={`spotlight-photo spotlight-photo-${index + 1}`} key={item.id}><Image src={item.image_url!} alt={`${item.name}, ${item.category}`} fill unoptimized sizes="(max-width: 760px) 33vw, 300px" /></div>) : <div className="spotlight-empty-art"><span>O</span><i/></div>}
            <div className="home-spotlight-copy"><span className="editorial-kicker">{nextOutfit ? 'PROGRAMADO' : 'DESTACADO'}</span><h2 id="home-spotlight-title">{featuredOutfit?.name || (garmentCount ? 'Tu siguiente outfit' : 'Añade una prenda')}</h2><button className="spotlight-link" type="button" onClick={() => setSection(featuredOutfit ? 'Outfits' : garmentCount ? 'Outfits' : 'Closet')}>{featuredOutfit ? 'Ver outfit' : garmentCount ? 'Crear outfit' : 'Añadir prenda'} <span>↗</span></button></div>
            <span className="spotlight-index">O—01</span>
          </div>
        </section>

        <section className="home-wardrobe-strip" aria-label="Resumen del closet"><div className="wardrobe-strip-intro"><span className="eyebrow">RESUMEN</span><button type="button" onClick={() => setSection('Closet')}>Ver closet ↗</button></div><div className="wardrobe-strip-stat"><b>{garmentCount.toString().padStart(2, '0')}</b><span>prendas<br/>guardadas</span></div><div className="wardrobe-strip-stat"><b>{outfitCount.toString().padStart(2, '0')}</b><span>outfits<br/>creados</span></div><div className="wardrobe-strip-stat"><b>{nextOutfit ? '01' : '—'}</b><span>{nextOutfit ? 'siguiente' : 'sin programar'}</span></div></section>

        <section className="home-planning" aria-label="Planificación de outfits"><div className="planning-heading"><div><span className="eyebrow">PLANIFICACIÓN</span><h2>Calendario</h2></div><span className="planning-date">{new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(new Date())}</span></div><div className="home-grid"><WardrobeCalendar enabled={supabaseConfigured} /><section className="next-look-panel"><span className="next-look-index">SIGUIENTE</span><div className="eyebrow">EN CALENDARIO</div><h3>{nextOutfit?.name || (outfitCount ? 'Elige un outfit' : 'Sin outfit programado')}</h3><p>{nextOutfit ? `Planeado para el ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'long' }).format(new Date(`${nextOutfit.date}T00:00:00`))}.` : 'Asigna un outfit desde el calendario.'}</p><button className="text-button" type="button" onClick={() => setSection(outfitCount ? 'Outfits' : 'Closet')}>{outfitCount ? 'Ver outfits' : 'Ver closet'} <span>↗</span></button><div className="next-look-ornament" aria-hidden="true">O<span>·</span>O</div></section></div></section>

        <section className="home-recent-section"><div className="section-heading"><div><span className="eyebrow">OUTFITS</span><h2>Recientes</h2></div><button className="home-view-all" type="button" onClick={() => setSection('Outfits')}>Ver todos ↗</button></div>{recentOutfits.length ? <div className="home-recent-grid">{recentOutfits.slice(0, 3).map((outfit, index) => { const images = outfit.items.filter(item => item.image_url).slice(0, 3); return <button className={`home-recent-card recent-card-${index + 1}`} type="button" key={outfit.id} onClick={() => setSection('Outfits')} aria-label={`Abrir outfit ${outfit.name}`}><span className="recent-card-images">{images.length ? images.map((item, imageIndex) => <span className={`recent-image recent-image-${imageIndex + 1}`} key={item.id}><Image src={item.image_url!} alt={`${item.name}, ${item.category}`} fill unoptimized sizes="(max-width: 760px) 35vw, 180px" /></span>) : <span className="recent-empty-art"><i>O</i><small>O-CLOÜD</small></span>}</span><span className="recent-card-copy"><small>{outfit.is_favorite ? 'FAVORITO' : outfit.occasion || outfit.season || 'OUTFIT'}</small><b>{outfit.name}</b><i>{outfit.items.length} prendas <span>↗</span></i></span></button>; })}</div> : <div className="home-recent-empty"><div><span>O</span><i>+</i></div><p>Sin outfits guardados.</p><button className="text-button" type="button" onClick={() => setSection(garmentCount ? 'Outfits' : 'Closet')}>{garmentCount ? 'Crear outfit ↗' : 'Añadir prenda ↗'}</button></div>}</section>

        <section className="home-shortcuts" aria-labelledby="shortcut-title"><div className="section-heading"><div><h2 id="shortcut-title">Acciones</h2></div></div><div className="home-action-grid"><button className="home-action home-action-add" type="button" onClick={openAddClothing}><span className="home-action-mark">＋</span><span><b>Añadir prenda</b></span><i>↗</i></button><button className="home-action home-action-style" type="button" onClick={() => setSection('Outfits')}><span className="home-action-mark">◈</span><span><b>Crear outfit</b></span><i>↗</i></button></div></section>

        <section className="home-inspiration"><div className="section-heading"><div><h2>Estilista</h2></div></div><WeatherStylist enabled={supabaseConfigured} /></section>
      </div>}
      {section === 'Closet' && <div className="content subpage"><GarmentCloset enabled={supabaseConfigured} processorAvailable={processorAvailable} tripoAvailable={tripoAvailable} addRequest={addRequest} /></div>}
      {section === 'Outfits' && <div className="content subpage"><OutfitStudio enabled={supabaseConfigured} /></div>}
      {section === 'Perfil' && <div className="content subpage"><div className="page-title-row"><div><h1>Perfil</h1></div></div>{(authError || authNotice) && <AuthNotice error={authError} notice={authNotice} configured={Boolean(email)}/>}<div className="profile-card"><div className="profile-cover"><span>O-CLOÜD</span><div className="profile-avatar">{avatarPreview || avatarUrl ? <Image src={avatarPreview || avatarUrl!} alt="Foto de perfil" width={76} height={76} unoptimized /> : displayName.slice(0, 1).toUpperCase() || 'O'}</div><label className="profile-avatar-picker" htmlFor="profile-avatar">Cambiar foto</label></div><div className="profile-form"><form action={updateProfile}><input className="profile-avatar-input" id="profile-avatar" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Cambiar foto de perfil" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) setAvatarPreview(URL.createObjectURL(file)); }} disabled={!email}/><label htmlFor="profile-username">Nombre de usuario<div className="profile-username-field"><span aria-hidden="true">@</span><input id="profile-username" name="username" defaultValue={username} placeholder="usuario" pattern="[A-Za-z0-9_]{3,24}" maxLength={24} disabled={!email}/></div></label><label htmlFor="profile-display-name">Nombre para mostrar<input id="profile-display-name" name="display_name" defaultValue={displayName} placeholder="Tu nombre" required maxLength={80} disabled={!email}/></label><label>Correo electrónico<input value={email} placeholder="No hay sesión iniciada" disabled readOnly /></label><div className="form-bottom profile-form-bottom"><button className="primary-button" type="submit" disabled={!email}>Guardar cambios</button></div></form>{email && <form action={signOut} className="signout-form"><button className="text-button" type="submit">Cerrar sesión　↗</button></form>}</div><div className="profile-preferences"><div className="eyebrow">PREFERENCIAS</div><div><span>✳</span><b>Tu estilo personal</b><small>Preferencias, colores y ocasiones favoritas</small></div><div><span>⌖</span><b>Tu ubicación</b><small>Para ideas de outfits según el clima</small></div><div><span>♡</span><b>Privacidad y bienestar</b><small>Tus datos, siempre bajo tu control</small></div></div></div></div>}
      <footer className="footer"><span>O-CLOÜD © 2026</span><a href="/privacy">Privacidad ↗</a></footer>
    </section>
    <nav className="mobile-nav" aria-label="Navegación móvil"><button type="button" aria-current={section === 'Inicio' ? 'page' : undefined} onClick={() => setSection('Inicio')} className={section === 'Inicio' ? 'active' : ''}><span aria-hidden="true">⌂</span>Inicio</button><button type="button" aria-current={section === 'Closet' ? 'page' : undefined} onClick={() => setSection('Closet')} className={section === 'Closet' ? 'active' : ''}><span aria-hidden="true">▤</span>Closet</button><button type="button" className="mobile-nav-add" aria-label="Añadir una prenda" onClick={openAddClothing}><span aria-hidden="true">＋</span></button><button type="button" aria-current={section === 'Outfits' ? 'page' : undefined} onClick={() => setSection('Outfits')} className={section === 'Outfits' ? 'active' : ''}><span aria-hidden="true">◈</span>Outfits</button><button type="button" aria-current={section === 'Perfil' ? 'page' : undefined} onClick={() => setSection('Perfil')} className={section === 'Perfil' ? 'active' : ''}><span aria-hidden="true">○</span>Perfil</button></nav>
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}

