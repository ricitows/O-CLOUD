import type { EmailOtpType } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';

const allowedTypes: EmailOtpType[] = ['signup', 'email', 'recovery', 'magiclink', 'invite', 'email_change'];
const safeNext = (value: string | null, requestUrl: string) => {
  if (!value) return '/';
  try {
    const target = new URL(value, requestUrl);
    return target.origin === new URL(requestUrl).origin ? `${target.pathname}${target.search}${target.hash}` : '/';
  } catch {
    return '/';
  }
};

export async function GET(request: NextRequest) {
  if (!hasSupabaseConfig()) return NextResponse.redirect(new URL('/login?error=not-configured', request.url));
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const typeValue = searchParams.get('type');
  const next = safeNext(searchParams.get('next'), request.url);

  if (!tokenHash || !typeValue || !allowedTypes.includes(typeValue as EmailOtpType)) {
    return NextResponse.redirect(new URL('/login?error=confirm-failed', request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: typeValue as EmailOtpType });
  if (error) return NextResponse.redirect(new URL('/login?error=confirm-failed', request.url));
  if (typeValue === 'recovery' && next !== '/update-password') {
    return NextResponse.redirect(new URL('/update-password', request.url));
  }
  return NextResponse.redirect(new URL(next, request.url));
}
