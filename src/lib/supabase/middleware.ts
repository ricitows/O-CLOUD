import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseEnv, hasSupabaseConfig } from './env';

function redirectWithSessionCookies(destination: URL, response: NextResponse) {
  const redirectResponse = NextResponse.redirect(destination);
  response.cookies.getAll().forEach(cookie => redirectResponse.cookies.set(cookie));
  for (const header of ['cache-control', 'expires', 'pragma']) {
    const value = response.headers.get(header);
    if (value) redirectResponse.headers.set(header, value);
  }
  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  if (!hasSupabaseConfig()) return NextResponse.next({ request });

  const { url, key } = getSupabaseEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login')
    || request.nextUrl.pathname.startsWith('/register')
    || request.nextUrl.pathname.startsWith('/forgot-password')
    || request.nextUrl.pathname.startsWith('/update-password')
    || request.nextUrl.pathname.startsWith('/auth/');

  const isApiRoute = request.nextUrl.pathname.startsWith('/api/');
  if (!claims && !isAuthRoute && !isApiRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', request.nextUrl.pathname);
    return redirectWithSessionCookies(loginUrl, response);
  }

  if (claims && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/register')) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    homeUrl.search = '';
    return redirectWithSessionCookies(homeUrl, response);
  }

  return response;
}
