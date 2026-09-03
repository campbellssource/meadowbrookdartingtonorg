// POST /api/booking/find — { email }
//
// "I have lost the link." Always answers identically whether or not we hold
// bookings for the address: anything else is an account-enumeration oracle, and
// "do you have a booking for alice@example.com" is not a question a stranger
// should be able to ask.

import type { APIRoute } from 'astro';
import { upcomingBookingsFor, recordToken, revokeTokensFor, rateLimit } from '../../../lib/booking/store.ts';
import { issue } from '../../../lib/booking/token.ts';
import { getRoomConfig } from '../../../lib/booking/config-reader.ts';
import { findLinksEmail, send } from '../../../lib/booking/email.ts';
import { BOOKING_HEADERS } from '../../../lib/booking/session.ts';
import { canonicalOrigin } from '../../../lib/booking/env.ts';

export const prerender = false;

const SAME_ANSWER = 'If we hold any upcoming bookings for that address, we have emailed you a link.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...BOOKING_HEADERS },
  });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  let body: Record<string, any>;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  const email = String(body.email ?? '').trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);

  // Both limits return the same message as success, so a rate limit cannot be used
  // to distinguish a known address from an unknown one either.
  const ip = clientAddress ?? 'unknown';
  const [byEmail, byIp] = await Promise.all([
    rateLimit(`find:email:${email}`, 3, 60),
    rateLimit(`find:ip:${ip}`, 10, 60),
  ]);
  if (!byEmail.allowed || !byIp.allowed) {
    console.warn('booking/find: rate limited', { limited: !byEmail.allowed ? 'email' : 'ip' });
    return json({ message: SAME_ANSWER });
  }

  try {
    const bookings = await upcomingBookingsFor(email);
    if (bookings.length > 0) {
      // Not request.url: these links are emailed and outlive the request.
      const origin = canonicalOrigin(new URL(request.url).origin);
      const items = [];
      for (const { ref, booking } of bookings) {
        // Re-issuing invalidates the old link, so a forwarded or leaked one stops
        // working the moment the real owner asks for a new one.
        await revokeTokensFor(ref);
        const { token, jti } = issue(ref, email, booking.end.toDate());
        await recordToken(jti, ref, email);
        const room = await getRoomConfig(booking.room);
        items.push({
          roomName: room?.shortName ?? booking.room,
          start: booking.start.toDate(),
          url: `${origin}/bookings/${ref}?t=${token}`,
        });
      }
      items.sort((a, b) => a.start.getTime() - b.start.getTime());
      await send(findLinksEmail(email, items));
    }
  } catch (err) {
    // Logged, but the caller still gets the standard answer -- an error that only
    // occurs for known addresses would leak the same fact the flow exists to hide.
    console.error('booking/find: failed', err);
  }

  return json({ message: SAME_ANSWER });
};
