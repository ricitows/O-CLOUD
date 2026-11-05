import Link from 'next/link';
import { AuthNotice, AuthShell } from '@/components/auth/AuthShell';
import { signIn } from '@/app/auth/actions';
import { hasSupabaseConfig } from '@/lib/supabase/env';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; next?: string }> }) {
  const params = await searchParams;
  const configured = hasSupabaseConfig();
  return <AuthShell title="Iniciar sesión">
    <AuthNotice error={params.error} notice={params.notice} configured={configured}/>
    <form action={signIn} className="auth-form">
      <input type="hidden" name="next" value={params.next || '/'} />
      <label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" placeholder="tu@correo.com" required maxLength={254}/>
      <label htmlFor="password">Contraseña</label>
      <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Tu contraseña" required minLength={8}/>
      <div className="auth-recovery"><Link href="/forgot-password">¿Olvidaste tu contraseña?</Link></div>
      <button className="primary-button auth-submit" type="submit" disabled={!configured}>Iniciar sesión <span>→</span></button>
    </form>
    <div className="auth-switch">¿No tienes cuenta? <Link href="/register">Crear cuenta</Link></div>
  </AuthShell>;
}
