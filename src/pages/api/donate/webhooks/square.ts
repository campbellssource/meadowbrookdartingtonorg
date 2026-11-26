// POST /api/donate/webhooks/square
//
// Where a donation is actually recorded: Square says a payment completed, and the
// donation (and its Gift Aid declaration, if any) is written from the intent that
// /api/donate created before charging. Refunds mark the donation Refunded.
//
// Separate from the booking webhook because it is a separate subscription, on
// /donate's Square application, with its own signature key. The logic lives in
// lib/gift-aid/webhook.ts; this file is the door.

import type { APIRoute } from 'astro';
import { env } from '../../../../lib/booking/env.ts';
import { processDonationEvent, verifySquareSignature } from '../../../../lib/gift-aid/webhook.ts';
import { webhookDeps, alert } from '../../../../lib/gift-aid/service.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();
  // Configured, not derived from the request: behind Cloud Run the Host header is
  // not necessarily the URL Square signed.
  const notificationUrl = env('DONATE_SQUARE_WEBHOOK_URL')
    ?? 'https://meadowbrookdartington.org/api/donate/webhooks/square';

  if (!verifySquareSignature(env('DONATE_SQUARE_WEBHOOK_SIGNATURE_KEY'), notificationUrl, rawBody,
    request.headers.get('x-square-hmacsha256-signature'))) {
    console.warn('donate webhook: bad signature');
    return new Response('Bad signature.', { status: 401 });
  }

  let event: Record<string, any>;
  try { event = JSON.parse(rawBody); } catch { return new Response('Bad body.', { status: 400 }); }

  try {
    const result = await processDonationEvent(event, webhookDeps);
    console.log('donate webhook', { type: event.type, eventId: event.event_id, result });
    if (result === 'unknown-intent') {
      // A payment carrying one of our references with no intent behind it. The TTL
      // is 30 days, so this should never happen; if it does, money arrived that we
      // cannot attach a declaration to, and a person needs to look.
      await alert('Donation webhook: payment with no intent', [
        `Square event ${event.event_id} (${event.type}) is for a completed payment whose donation intent is missing.`,
        'The money has been taken but no donation was recorded. Find the payment in Square and enter it on /admin/gift-aid.',
      ]);
    }
  } catch (err) {
    console.error('donate webhook: failed', err);
    // A failure on our side is worth Square retrying: recording is idempotent.
    return new Response('Retry.', { status: 500 });
  }
  // 200 for everything else, including payments that are not donations: retrying
  // an event that is none of our business would never succeed.
  return new Response('OK', { status: 200 });
};
