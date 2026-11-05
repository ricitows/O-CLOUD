'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';

const validEmail = (value: FormDataEntryValue | null): value is string =>
  typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const validUsername = (value: string) => /^[a-z0-9_]{3,24}$/.test(value);
const validAvatarSignature = (bytes: Uint8Array, mime: string) => {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  return mime === 'image/webp' && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
};
const safeNext = (value: FormDataEntryValue | null) => {
  if (typeof value !== 'string') return '/';
  try {
    const target = new URL(value, 'https://o-cloud.invalid');
    return target.origin === 'https://o-cloud.invalid' ? `${target.pathname}${target.search}${target.hash}` : '/';
  } catch {
    return '/';
  }
};
const siteUrl = () => process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

export async function signIn(formData: FormData) {
  if (!hasSupabaseConfig()) redirect('/login?error=not-configured');
  const email = formData.get('email');
  const password = formData.get('password');
  if (!validEmail(email) || typeof password !== 'string' || password.length < 8) redirect('/login?error=invalid-input');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) redirect('/login?error=auth-failed');
  revalidatePath('/', 'layout');
  redirect(safeNext(formData.get('next')));
}

export async function signUp(formData: FormData) {
  if (!hasSupabaseConfig()) redirect('/register?error=not-configured');
  const email = formData.get('email');
  const password = formData.get('password');
  const displayNameValue = formData.get('display_name');
  if (!validEmail(email) || typeof password !== 'string' || password.length < 10
    || typeof displayNameValue !== 'string' || displayNameValue.trim().length > 80) {
    redirect('/register?error=invalid-input');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/confirm?next=/`,
      data: { display_name: displayNameValue.trim() },
    },
  });
  if (error) redirect('/register?error=signup-failed');
  redirect('/register?notice=check-email');
}

export async function requestPasswordReset(formData: FormData) {
  if (!hasSupabaseConfig()) redirect('/forgot-password?error=not-configured');
  const email = formData.get('email');
  if (!validEmail(email)) redirect('/forgot-password?error=invalid-input');

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${siteUrl()}/auth/confirm?next=/update-password`,
  });
  if (error) redirect('/forgot-password?error=reset-failed');
  redirect('/forgot-password?notice=check-email');
}

export async function updatePassword(formData: FormData) {
  if (!hasSupabaseConfig()) redirect('/login?error=not-configured');
  const password = formData.get('password');
  const confirmation = formData.get('confirmation');
  if (typeof password !== 'string' || password.length < 10 || password !== confirmation) {
    redirect('/update-password?error=invalid-input');
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) redirect('/login?error=auth-required');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect('/update-password?error=update-failed');
  revalidatePath('/', 'layout');
  redirect('/?notice=password-updated');
}

export async function signOut() {
  if (!hasSupabaseConfig()) redirect('/');
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login?notice=signed-out');
}

export async function updateProfile(formData: FormData) {
  if (!hasSupabaseConfig()) redirect('/login?error=not-configured');
  const displayNameValue = formData.get('display_name');
  if (typeof displayNameValue !== 'string' || displayNameValue.trim().length < 1 || displayNameValue.trim().length > 80) {
    redirect('/?error=profile-invalid');
  }
  const usernameValue = formData.get('username');
  const username = typeof usernameValue === 'string' ? usernameValue.trim().replace(/^@/, '').toLowerCase() : '';
  if (username && !validUsername(username)) redirect('/?error=username-invalid');
  const avatarValue = formData.get('avatar');
  const avatar = avatarValue instanceof File && avatarValue.size > 0 ? avatarValue : null;
  if (avatar && (!['image/jpeg', 'image/png', 'image/webp'].includes(avatar.type) || avatar.size > 5 * 1024 * 1024)) {
    redirect('/?error=avatar-invalid');
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims.sub) redirect('/login?error=auth-required');
  const userId = claimsData.claims.sub;
  const { data: currentProfile } = await supabase.from('profiles').select('avatar_path').eq('id', userId).maybeSingle();
  let avatarPath = currentProfile?.avatar_path || null;
  let uploadedAvatarPath: string | null = null;

  if (avatar) {
    const bytes = new Uint8Array(await avatar.arrayBuffer());
    if (!validAvatarSignature(bytes, avatar.type)) redirect('/?error=avatar-invalid');
    const extension = avatar.type === 'image/jpeg' ? 'jpg' : avatar.type === 'image/png' ? 'png' : 'webp';
    uploadedAvatarPath = `${userId}/avatars/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from('private-photos').upload(uploadedAvatarPath, bytes, {
      contentType: avatar.type,
      cacheControl: '3600',
      upsert: false,
    });
    if (uploadError) redirect('/?error=avatar-save');
    avatarPath = uploadedAvatarPath;
  }

  const { error } = await supabase.from('profiles').upsert({
    id: userId,
    display_name: displayNameValue.trim(),
    username: username || null,
    avatar_path: avatarPath,
  });
  if (error) {
    if (uploadedAvatarPath) await supabase.storage.from('private-photos').remove([uploadedAvatarPath]);
    if (error.code === '23505') redirect('/?error=username-taken');
    // Keep database diagnostics useful without writing profile data or credentials to logs.
    console.error('[profile-save] Database upsert failed', { code: error.code });
    if (error.code === '42501') redirect('/?error=profile-permission');
    if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205') {
      redirect('/?error=profile-schema');
    }
    redirect('/?error=profile-save');
  }
  if (uploadedAvatarPath && currentProfile?.avatar_path && currentProfile.avatar_path !== uploadedAvatarPath
    && currentProfile.avatar_path.startsWith(`${userId}/avatars/`)) {
    await supabase.storage.from('private-photos').remove([currentProfile.avatar_path]);
  }
  revalidatePath('/', 'layout');
  redirect('/?notice=profile-saved');
}

