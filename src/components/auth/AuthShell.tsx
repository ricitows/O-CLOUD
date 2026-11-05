import Link from 'next/link';

export function AuthShell({ children, eyebrow, title, subtitle }: {
  children: React.ReactNode;
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return <main className="auth-page">
    <section className="auth-card">
      <Link href="/" className="auth-brand">O-CLOÜD</Link>
      <div className="auth-content">{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{subtitle && <p className="auth-subtitle">{subtitle}</p>}{children}</div>
    </section>
  </main>;
}

export function AuthNotice({ error, notice, configured }: { error?: string; notice?: string; configured: boolean }) {
  const messages: Record<string, string> = {
    'invalid-input': 'Revisa los datos. La contraseña debe tener al menos 10 caracteres.',
    'auth-failed': 'No pudimos iniciar sesión con esos datos. Revisa tu correo y contraseña.',
    'signup-failed': 'No pudimos crear la cuenta. Inténtalo de nuevo más tarde.',
    'reset-failed': 'No pudimos solicitar el enlace. Inténtalo de nuevo más tarde.',
    'update-failed': 'No pudimos actualizar tu contraseña. Solicita un nuevo enlace.',
    'confirm-failed': 'El enlace expiró o ya fue utilizado. Solicita uno nuevo.',
    'auth-required': 'La sesión de recuperación expiró. Solicita un nuevo enlace.',
    'not-configured': 'Falta conectar Supabase. Completa las variables locales indicadas en el README.',
    'profile-invalid': 'Escribe un nombre de perfil de hasta 80 caracteres.',
    'username-invalid': 'El usuario debe tener de 3 a 24 letras, números o guiones bajos.',
    'username-taken': 'Ese nombre de usuario ya está en uso.',
    'avatar-invalid': 'Elige una imagen JPG, PNG o WEBP de hasta 5 MB.',
    'avatar-save': 'No se pudo guardar la foto de perfil. Inténtalo de nuevo.',
    'profile-save': 'No pudimos guardar el perfil. Inténtalo de nuevo; si continúa, revisa los registros del servidor.',
    'profile-schema': 'La base de datos conectada no reconoce los campos del perfil. Verifica que tenga el esquema de O-CLOÜD actualizado; no se ejecutó ninguna migración.',
    'profile-permission': 'Supabase rechazó el cambio por permisos. Comprueba que sigues dentro de tu cuenta e inténtalo de nuevo.',
  };
  const notices: Record<string, string> = {
    'check-email': 'Si la cuenta es válida, recibirás un correo con los siguientes pasos.',
    'signed-out': 'Has cerrado sesión.',
    'password-updated': 'Tu contraseña se actualizó correctamente.',
    'profile-saved': 'Tu nombre para mostrar se guardó.',
  };
  return <>
    {!configured && <div className="auth-notice neutral" role="status">La autenticación necesita la configuración de Supabase en <code>.env.local</code>.</div>}
    {error && <div className="auth-notice error" role="alert">{messages[error] || 'No se pudo completar la solicitud.'}</div>}
    {notice && <div className="auth-notice success" role="status">{notices[notice] || 'Solicitud completada.'}</div>}
  </>;
}
