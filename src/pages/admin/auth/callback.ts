// Google OAuth callback for /admin.
//
// Verifies the ID token's signature via Google's tokeninfo endpoint rather than
// trusting the response body, checks the hosted domain and the allowlist, then
// issues a short session.

import type { APIRoute } from 'astro';
import { isAllowed, signSession, ADMIN_COOKIE } from '../../../lib/booking/admin-auth.ts';
import { env } from '../../../lib/booking/env.ts';

export const prerender = false;

const fail = (why: string) =>
  new Response(null, { status: 302, headers: { Location: `/admin/signin?denied=${why}` } });

export const GET: APIRoute = async ({ url, cookies }) => {
  const code = url.searchParams.get('code');
  const clientId = env('BOOKING_ADMIN_OAUTH_CLIENT_ID');
  const clientSecret = env('BOOKING_ADMIN_OAUTH_CLIENT_SECRET');
  if (!code || !clientId || !clientSecret) return fail('config');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: new URL('/admin/auth/callback', url.origin).toString(),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return fail('exchange');
    const { id_token: idToken } = await tokenRes.json() as { id_token?: string };
    if (!idToken) return fail('exchange');

    // Verified by Google rather than decoded locally: this is the whole basis of
    // the session, so it does not get parsed on trust.
    const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!infoRes.ok) return fail('verify');
    const info = await infoRes.json() as {
      email?: string; email_verified?: string | boolean; aud?: string; hd?: string;
    };

    if (info.aud !== clientId) return fail('verify');
    if (String(info.email_verified) !== 'true') return fail('verify');
    if (info.hd !== 'meadowbrookdartington.org') return fail('not-allowed');
    if (!isAllowed(info.email)) return fail('not-allowed');

    cookies.set(ADMIN_COOKIE, signSession(info.email!), {
      httpOnly: true, sameSite: 'lax', path: '/',
      secure: url.protocol === 'https:', maxAge: 12 * 3600,
    });
    return new Response(null, { status: 302, headers: { Location: '/admin/bookings' } });
  } catch (err) {
    console.error('admin: oauth callback failed', err);
    return fail('exchange');
  }
};
