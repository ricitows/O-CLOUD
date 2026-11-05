import Link from 'next/link';
import { AuthNotice, AuthShell } from '@/components/auth/AuthShell';
import { updatePassword } from '@/app/auth/actions';
import { hasSupabaseConfig } from '@/lib/supabase/env';

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const configured = hasSupabaseConfig();
  return <AuthShell title="Nueva contraseña" subtitle="Usa al menos 10 caracteres que no utilices en otros sitios.">
    <AuthNotice error={params.error} configured={configured}/>
    <form action={updatePassword} className="auth-form">
      <label htmlFor="password">Nueva contraseña</label><input id="password" name="password" type="password" autoComplete="new-password" required minLength={10}/>
      <label htmlFor="confirmation">Confirma la contraseña</label><input id="confirmation" name="confirmation" type="password" autoComplete="new-password" required minLength={10}/>
      <button className="primary-button auth-submit" type="submit" disabled={!configured}>Actualizar contraseña <span>→</span></button>
    </form>
    <div className="auth-switch"><Link href="/login">← Volver a iniciar sesión</Link></div>
  </AuthShell>;
}
