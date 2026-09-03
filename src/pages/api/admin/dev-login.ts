// Local-only admin sign-in, for use before the Google OAuth client exists.
//
// Gated twice: NODE_ENV must not be production, and BOOKING_ADMIN_DEV_LOGIN must
// be explicitly "true". The email must still be on the allowlist, so this is a
// shortcut past Google, not past authorisation.

import type { APIRoute } from 'astro';
import { devLoginAllowed, isAllowed, signSession, ADMIN_COOKIE } from '../../../lib/booking/admin-auth.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url }) => {
  if (!devLoginAllowed()) return new Response('Not available.', { status: 404 });

  // JSON, not a form: see the note in admin/signin.astro.
  let email = '';
  try {
    const body = await request.json() as { email?: string };
    email = String(body.email ?? '').trim().toLowerCase();
  } catch {
    return new Response('Invalid request.', { status: 400 });
  }
  if (!isAllowed(email)) return new Response('Not on the admin list.', { status: 403 });

  cookies.set(ADMIN_COOKIE, signSession(email), {
    httpOnly: true, sameSite: 'lax', path: '/',
    secure: url.protocol === 'https:', maxAge: 12 * 3600,
  });
  console.warn('admin: dev login used', { email });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
