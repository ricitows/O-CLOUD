import Link from 'next/link';
import { AuthNotice, AuthShell } from '@/components/auth/AuthShell';
import { requestPasswordReset } from '@/app/auth/actions';
import { hasSupabaseConfig } from '@/lib/supabase/env';

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const params = await searchParams;
  const configured = hasSupabaseConfig();
  return <AuthShell title="Recuperar contraseña" subtitle="Te enviaremos un enlace para crear una contraseña nueva.">
    <AuthNotice error={params.error} notice={params.notice} configured={configured}/>
    <form action={requestPasswordReset} className="auth-form">
      <label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" placeholder="tu@correo.com" required maxLength={254}/>
      <button className="primary-button auth-submit" type="submit" disabled={!configured}>Enviar enlace <span>→</span></button>
    </form>
    <div className="auth-switch"><Link href="/login">← Volver a iniciar sesión</Link></div>
  </AuthShell>;
}
