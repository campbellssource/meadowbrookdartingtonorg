// POST /api/booking/webhooks/square
//
// Square tells us when a payment or refund reaches its final state. Without this,
// a refund sits in our ledger as `pending` while Square has long since completed
// it, and `paidPence` overstates what the DRA holds (`04`).
//
// The payload is a hint, not truth: it is used to find the booking, and the status
// is then read back from Square's API. A webhook body is attacker-shaped input
// even with a valid signature, and the API is authoritative regardless.

import type { APIRoute } from 'astro';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../../../lib/booking/env.ts';
import { settlePayment } from '../../../../lib/booking/reconcile.ts';

export const prerender = false;

/**
 * Square signs the notification URL concatenated with the raw body.
 *
 * The URL must match what is configured in Square exactly. Behind Cloud Run the
 * request's own host header is not necessarily that, so it is configured rather
 * than derived from the request.
 */
function verifySignature(rawBody: string, signature: string | null, notificationUrl: string): boolean {
  const key = env('BOOKING_SQUARE_WEBHOOK_SIGNATURE_KEY');
  if (!key || !signature) return false;
  const expected = createHmac('sha256', key).update(notificationUrl + rawBody).digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const POST: APIRoute = async ({ request }) => {
  const rawBody = await request.text();
  const notificationUrl = env('BOOKING_SQUARE_WEBHOOK_URL')
    ?? 'https://meadowbrookdartington.org/api/booking/webhooks/square';

  if (!verifySignature(rawBody, request.headers.get('x-square-hmacsha256-signature'), notificationUrl)) {
    console.warn('square webhook: bad signature');
    return new Response('Bad signature.', { status: 401 });
  }

  let event: { type?: string; data?: { object?: Record<string, any> } };
  try { event = JSON.parse(rawBody); } catch { return new Response('Bad body.', { status: 400 }); }

  const object = event.data?.object ?? {};
  const ref = object.payment?.reference_id ?? object.refund?.reference_id ?? null;
  const paymentId = object.payment?.id ?? object.refund?.payment_id ?? null;
  const refundId = object.refund?.id ?? null;

  console.log('square webhook', { type: event.type, ref, refundId });

  try {
    const result = await settlePayment({ bookingRef: ref, squarePaymentId: paymentId, squareRefundId: refundId });
    // 200 even for an unknown booking: Square retries non-2xx, and retrying an
    // event about a booking we do not hold would never succeed.
    console.log('square webhook: settled', { ref, result });
  } catch (err) {
    console.error('square webhook: settle failed', err);
    // A genuine failure on our side IS worth Square retrying.
    return new Response('Retry.', { status: 500 });
  }

  return new Response('OK', { status: 200 });
};
