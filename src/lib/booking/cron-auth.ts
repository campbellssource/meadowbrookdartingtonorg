// Authenticating the scheduled jobs.
//
// Cloud Scheduler calls these endpoints over the public internet, so they are as
// reachable as the booking form. Two accepted proofs:
//
//   1. A Google OIDC token, which is what Scheduler actually sends. Verified
//      against Google's signing keys, with the audience checked -- a valid Google
//      token minted for some other service must not open this one.
//   2. A shared secret header, for running a job by hand locally where there is no
//      Scheduler to mint a token.
//
// The secret is refused in production unless explicitly allowed, so the weaker
// proof cannot quietly become the one in use.

import { timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { env } from './env.ts';

const SCHEDULER_SA = 'booking-scheduler@meadowbrook-booking.iam.gserviceaccount.com';

let client: OAuth2Client | null = null;

export type CronAuth =
  | { ok: true; via: 'oidc' | 'secret' }
  | { ok: false; reason: string };

export async function authoriseCron(request: Request, expectedAudience: string): Promise<CronAuth> {
  const header = request.headers.get('authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7);
    try {
      client ??= new OAuth2Client();
      const ticket = await client.verifyIdToken({ idToken: token, audience: expectedAudience });
      const payload = ticket.getPayload();
      if (!payload) return { ok: false, reason: 'no-payload' };
      // Audience alone is not enough: check who minted it.
      if (payload.email !== SCHEDULER_SA) return { ok: false, reason: 'wrong-principal' };
      if (payload.email_verified === false) return { ok: false, reason: 'unverified' };
      return { ok: true, via: 'oidc' };
    } catch (err) {
      console.warn('cron: OIDC verification failed', err instanceof Error ? err.message : String(err));
      return { ok: false, reason: 'bad-token' };
    }
  }

  const secret = env('BOOKING_CRON_SECRET');
  const provided = request.headers.get('x-cron-secret');
  if (secret && provided) {
    if (process.env.NODE_ENV === 'production' && env('BOOKING_CRON_ALLOW_SECRET') !== 'true') {
      return { ok: false, reason: 'secret-not-allowed-in-production' };
    }
    // Constant-time. `===` on strings short-circuits at the first differing byte,
    // which is a measurable oracle on an internet-reachable endpoint. Length is
    // checked first because timingSafeEqual throws on a mismatch -- and length is
    // not the secret.
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true, via: 'secret' };
    return { ok: false, reason: 'bad-secret' };
  }

  return { ok: false, reason: 'no-credential' };
}
