// Turning a magic-link token into an authorised booking, or a clear refusal.
//
// Three checks, and all three matter: the signature (is it ours), the record (has
// it been revoked, is it being hammered), and the reference (does it open *this*
// booking). Skipping the third would let a valid token for one booking open
// another, which is the whole point of scoping them.

import { verify } from './token.ts';
import { useToken, getBooking } from './store.ts';
import type { Booking } from './store.ts';

export type Authorised =
  | { ok: true; booking: Booking; ref: string; jti: string; email: string }
  | { ok: false; status: 401 | 403 | 404 | 429; message: string };

const REFUSALS: Record<string, { status: 401 | 403 | 429; message: string }> = {
  'not-configured': { status: 403, message: 'Booking links are not configured on this site.' },
  malformed: { status: 403, message: 'That link is not valid. Please use the link from your confirmation email.' },
  'bad-signature': { status: 403, message: 'That link is not valid. Please use the link from your confirmation email.' },
  expired: { status: 401, message: 'That link has expired. You can request a new one.' },
  unknown: { status: 403, message: 'That link is no longer valid. You can request a new one.' },
  revoked: { status: 403, message: 'That link has been replaced. Please use the most recent email, or request a new one.' },
  'rate-limited': { status: 429, message: 'Too many attempts. Please wait a few minutes and try again.' },
};

export async function authorise(ref: string, token: string | null): Promise<Authorised> {
  if (!token) {
    return { ok: false, status: 401, message: 'This booking needs the link from your confirmation email.' };
  }

  const v = verify(token);
  if (!v.ok) {
    const r = REFUSALS[v.reason];
    return { ok: false, status: r.status, message: r.message };
  }

  // Scope check before spending a rate-limit use: a token for another booking is
  // a refusal, not an attempt on this one.
  if (v.payload.ref !== ref) {
    return { ok: false, status: 403, message: 'That link is for a different booking.' };
  }

  const used = await useToken(v.payload.jti);
  if (!used.ok) {
    const r = REFUSALS[used.reason];
    return { ok: false, status: r.status, message: r.message };
  }

  const booking = await getBooking(ref);
  if (!booking) return { ok: false, status: 404, message: 'We cannot find that booking.' };

  return { ok: true, booking, ref, jti: v.payload.jti, email: v.payload.email };
}

/** Headers for anything rendering booking details. Tokens leak through all of these. */
export const BOOKING_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, private',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};
