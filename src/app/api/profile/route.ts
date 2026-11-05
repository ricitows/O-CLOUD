import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';

const validUsername = (value: string) => /^[a-z0-9_]{3,24}$/.test(value);
const validAvatarSignature = (bytes: Uint8Array, mime: string) => {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  return mime === 'image/webp'
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
};

export async function POST(request: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ error: 'Supabase no está configurado para guardar el perfil.' }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Tu sesión expiró. Inicia sesión de nuevo.' }, { status: 401 });
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'No pudimos leer los cambios del perfil.' }, { status: 400 }); }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Los datos del perfil no son válidos.' }, { status: 400 });
  }

  const input = body as { display_name?: unknown; username?: unknown; avatar_path?: unknown };
  const displayName = typeof input.display_name === 'string' ? input.display_name.trim() : '';
  const username = typeof input.username === 'string' ? input.username.trim().replace(/^@/, '').toLowerCase() : '';
  const requestedAvatarPath = typeof input.avatar_path === 'string' ? input.avatar_path : '';
  if (!displayName || displayName.length > 80) {
    return NextResponse.json({ error: 'Escribe un nombre para mostrar de hasta 80 caracteres.' }, { status: 400 });
  }
  if (username && !validUsername(username)) {
    return NextResponse.json({ error: 'El usuario debe tener de 3 a 24 letras, números o guiones bajos.' }, { status: 400 });
  }

  const { data: currentProfile, error: profileReadError } = await supabase
    .from('profiles').select('avatar_path').eq('id', user.id).maybeSingle();
  if (profileReadError) {
    console.error('[profile-save] Profile lookup failed', { code: profileReadError.code });
    return NextResponse.json({ error: 'No pudimos cargar el perfil. Inténtalo de nuevo.' }, { status: 500 });
  }

  let avatarPath = currentProfile?.avatar_path ?? null;
  if (requestedAvatarPath) {
    const [ownerId, folder, fileName] = requestedAvatarPath.split('/');
    const validFileName = /^[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(fileName ?? '');
    if (ownerId !== user.id || folder !== 'avatars' || !validFileName) {
      return NextResponse.json({ error: 'La ruta de la foto no es válida para tu cuenta.' }, { status: 400 });
    }

    const mime = fileName.endsWith('.jpg') ? 'image/jpeg' : fileName.endsWith('.png') ? 'image/png' : 'image/webp';
    const { data: image, error: imageError } = await supabase.storage.from('private-photos').download(requestedAvatarPath);
    if (imageError || !image || image.size <= 0 || image.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'No pudimos verificar la foto subida. Inténtalo de nuevo.' }, { status: 400 });
    }
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (!validAvatarSignature(bytes, mime)) {
      await supabase.storage.from('private-photos').remove([requestedAvatarPath]);
      return NextResponse.json({ error: 'El archivo no es una imagen JPG, PNG o WEBP válida.' }, { status: 400 });
    }
    avatarPath = requestedAvatarPath;
  }

  const { error: saveError } = await supabase.from('profiles').upsert({
    id: user.id,
    display_name: displayName,
    username: username || null,
    avatar_path: avatarPath,
  });
  if (saveError) {
    if (requestedAvatarPath) await supabase.storage.from('private-photos').remove([requestedAvatarPath]);
    if (saveError.code === '23505') {
      return NextResponse.json({ error: 'Ese nombre de usuario ya está en uso.' }, { status: 409 });
    }
    console.error('[profile-save] Profile update failed', { code: saveError.code });
    if (saveError.code === '42501') {
      return NextResponse.json({ error: 'Supabase rechazó el cambio por permisos. Inicia sesión de nuevo e inténtalo.' }, { status: 403 });
    }
    if (['42703', 'PGRST204', 'PGRST205'].includes(saveError.code)) {
      return NextResponse.json({ error: 'La base de datos conectada no reconoce los campos del perfil.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'No pudimos guardar el perfil. Inténtalo de nuevo.' }, { status: 500 });
  }

  if (requestedAvatarPath && currentProfile?.avatar_path && currentProfile.avatar_path !== requestedAvatarPath
    && currentProfile.avatar_path.startsWith(`${user.id}/avatars/`)) {
    await supabase.storage.from('private-photos').remove([currentProfile.avatar_path]);
  }

  return NextResponse.json({ ok: true });
}
