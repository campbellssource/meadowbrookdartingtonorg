// Who may open /admin.
//
// Sign in with Google, restricted to an explicit allowlist rather than to the
// Workspace domain. A domain check would admit every account the DRA ever creates,
// including shared and service mailboxes; a list is one env var to edit and is
// auditable at a glance.
//
// This is the door to every booker's contact details and to refund buttons, so it
// gets the boring, careful version.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from './env.ts';

const SESSION_HOURS = 12;
export const ADMIN_COOKIE = 'mb_admin';

export function adminEmails(): string[] {
  return (env('BOOKING_ADMIN_EMAILS') ?? '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

/**
 * Local sign-in without a Google OAuth client.
 *
 * Refused outright in production regardless of the flag, because the failure mode
 * of getting this wrong is "anyone can open the admin".
 */
export function devLoginAllowed(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return env('BOOKING_ADMIN_DEV_LOGIN') === 'true';
}

function secret(): string {
  const s = env('BOOKING_MAGIC_LINK_SECRET');
  if (!s) throw new Error('BOOKING_MAGIC_LINK_SECRET is not set');
  // Domain-separated from booking tokens: an admin session and a magic link must
  // never be interchangeable even though they share a key.
  return `admin:${s}`;
}

export function signSession(email: string, now = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + SESSION_HOURS * 3600;
  const body = Buffer.from(JSON.stringify({ email: email.toLowerCase(), exp }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(cookie: string | undefined, now = new Date()): string | null {
  if (!cookie) return null;
  const dot = cookie.indexOf('.');
  if (dot <= 0) return null;
  const body = cookie.slice(0, dot);
  const provided = Buffer.from(cookie.slice(dot + 1));
  const expected = Buffer.from(createHmac('sha256', secret()).update(body).digest('base64url'));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const { email, exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!email || !exp || exp * 1000 <= now.getTime()) return null;
    // Re-checked on every request, not just at sign-in: removing someone from the
    // allowlist must lock them out immediately, not in twelve hours.
    return isAllowed(email) ? String(email).toLowerCase() : null;
  } catch {
    return null;
  }
}

export const ADMIN_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, private',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};
