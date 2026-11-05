import Link from 'next/link';
import { AuthNotice, AuthShell } from '@/components/auth/AuthShell';
import { signUp } from '@/app/auth/actions';
import { hasSupabaseConfig } from '@/lib/supabase/env';

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const params = await searchParams;
  const configured = hasSupabaseConfig();
  return <AuthShell title="Crear cuenta">
    <AuthNotice error={params.error} notice={params.notice} configured={configured}/>
    <form action={signUp} className="auth-form">
      <label htmlFor="display_name">Cómo te llamamos</label><input id="display_name" name="display_name" autoComplete="name" placeholder="Tu nombre" required maxLength={80}/>
      <label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" placeholder="tu@correo.com" required maxLength={254}/>
      <label htmlFor="password">Crea una contraseña</label><input id="password" name="password" type="password" autoComplete="new-password" placeholder="Al menos 10 caracteres" required minLength={10}/>
      <p className="auth-help">Te enviaremos un enlace para confirmar tu correo.</p>
      <button className="primary-button auth-submit" type="submit" disabled={!configured}>Crear cuenta <span>→</span></button>
    </form>
    <div className="auth-switch">¿Ya tienes cuenta? <Link href="/login">Inicia sesión</Link></div>
  </AuthShell>;
}
