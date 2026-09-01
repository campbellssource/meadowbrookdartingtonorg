// Magic-link tokens.
//
// Identity here is "demonstrably controls the email address the booking was made
// with" (D5). No accounts, no passwords -- so the token in the emailed link is the
// entire authorisation story, and it has to be boring and correct.
//
// Hand-rolled rather than a JWT library: the payload is four fields we fully
// control, and a JWT brings a dependency plus the algorithm-confusion footgun
// (`alg: none`, HS/RS confusion) for no benefit at this size.

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from './env.ts';

export interface TokenPayload {
  /** Token id. Logged instead of the token, and the key for revocation. */
  jti: string;
  ref: string;
  email: string;
  /** Expiry, epoch seconds. */
  exp: number;
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'expired' | 'not-configured' };

const b64url = (buf: Buffer): string => buf.toString('base64url');

function secret(): string | null {
  return env('BOOKING_MAGIC_LINK_SECRET') ?? null;
}

function sign(body: string, key: string): string {
  return b64url(createHmac('sha256', key).update(body).digest());
}

/** Tokens last until 30 days past the booking's end: "it was in that email somewhere". */
export function expiryFor(bookingEnd: Date): number {
  return Math.floor((bookingEnd.getTime() + 30 * 86_400_000) / 1000);
}

export function issue(ref: string, email: string, bookingEnd: Date): { token: string; jti: string } {
  const key = secret();
  if (!key) throw new Error('BOOKING_MAGIC_LINK_SECRET is not set');
  const payload: TokenPayload = {
    jti: randomUUID(), ref, email: email.toLowerCase(), exp: expiryFor(bookingEnd),
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return { token: `${body}.${sign(body, key)}`, jti: payload.jti };
}

/**
 * Verifies signature and expiry. Says nothing about revocation -- that needs
 * Firestore and lives in `session.ts`, so this stays pure and testable.
 */
export function verify(token: string, now = new Date()): VerifyResult {
  const key = secret();
  if (!key) return { ok: false, reason: 'not-configured' };

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };
  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  const expected = sign(body, key);
  // Constant-time, and length-checked first because timingSafeEqual throws on a
  // length mismatch -- which would itself be a timing signal.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' };

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload?.jti || !payload?.ref || !payload?.email || !payload?.exp) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.exp * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };

  return { ok: true, payload };
}
