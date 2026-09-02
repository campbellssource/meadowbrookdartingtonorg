// POST /api/booking/cancel — { ref, token, confirm: true }
//
// Ordering, from spec/booking/05: refund BEFORE releasing the slot. A released
// slot can be rebooked by someone else within seconds, and at that point a failed
// refund has no clean unwind -- the room is gone and the money is still ours.
// Refunding first means the worst case is a refunded booking still holding a slot,
// which a human can fix calmly.

import type { APIRoute } from 'astro';
import { invalidateRoom } from '../../../lib/booking/cache.ts';
import { authorise, BOOKING_HEADERS } from '../../../lib/booking/session.ts';
import { getRoomConfig } from '../../../lib/booking/config-reader.ts';
import { deleteEvent } from '../../../lib/booking/calendar.ts';
import { applyChange, revokeTokensFor } from '../../../lib/booking/store.ts';
import { squareConfig, refund as squareRefund, PaymentError } from '../../../lib/booking/square.ts';
import { refundFor } from '../../../lib/booking/policy.ts';
import { freshenOne } from '../../../lib/booking/reconcile.ts';
import { formatPence } from '../../../lib/booking/pricing.ts';
import { cancellationEmail, ownerNotificationEmail, alertEmail, send } from '../../../lib/booking/email.ts';
import { envBool } from '../../../lib/booking/env.ts';

export const prerender = false;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...BOOKING_HEADERS },
  });

async function alert(subject: string, lines: string[]): Promise<void> {
  try { await send(alertEmail(subject, lines)); }
  catch (err) { console.error('booking/cancel: alert failed', err); }
}

export const POST: APIRoute = async ({ request, url }) => {
  let body: Record<string, any>;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  const ref = String(body.ref ?? '').trim();
  const token = body.token ? String(body.token) : null;

  const auth = await authorise(ref, token);
  if (!auth.ok) return json({ error: auth.message }, auth.status);

  // refundFor() reads paidPence, so settle anything pending before deciding what
  // money should move. A stale figure here refunds the wrong amount.
  const { booking: raw } = auth;
  const booking = await freshenOne(ref, raw);
  if (booking.status === 'cancelled') {
    return json({ error: 'That booking has already been cancelled.' }, 409);
  }
  if (booking.status !== 'confirmed') {
    return json({ error: 'That booking cannot be cancelled.' }, 409);
  }

  const start = booking.start.toDate();
  const now = new Date();
  const decision = refundFor({
    paidPence: booking.paidPence, currentPence: booking.pricePence, start, change: 'cancel',
  }, now);

  // A quote, so the UI can state the exact figure before the booker commits.
  if (body.confirm !== true) {
    return json({
      quote: true, refundPence: decision.refundPence, paidPence: booking.paidPence,
      message: decision.refundPence > 0
        ? `You will be refunded ${formatPence(decision.refundPence)}.`
        : 'This booking starts within the hour, so no refund is due.',
    });
  }

  const room = await getRoomConfig(booking.room);
  const roomName = room?.shortName ?? booking.room;

  // 1 — money first.
  let refundEntry;
  if (decision.refundPence > 0) {
    const cfg = squareConfig();
    if (!cfg) {
      console.error('booking/cancel: Square not configured');
      return json({ error: 'Cancellation is temporarily unavailable. Please contact us.' }, 500);
    }
    const charged = booking.payments.find((p) => p.kind === 'charge' && p.status === 'completed');
    if (!charged) {
      await alert('[ALERT] Cancel with no completed charge', [`Reference: ${ref}`]);
      return json({ error: 'We could not process a refund automatically. Please contact us.' }, 500);
    }
    try {
      const result = await squareRefund(cfg, {
        squarePaymentId: charged.squarePaymentId,
        amountPence: decision.refundPence,
        // Deterministic: derived from the booking and its history length, so a
        // replayed cancellation cannot refund twice.
        idempotencyKey: `${ref}:${booking.history.length}`,
        reason: 'Booking cancelled by customer',
      });
      refundEntry = {
        kind: 'refund' as const, amountPence: decision.refundPence,
        squarePaymentId: charged.squarePaymentId, squareRefundId: result.squareRefundId,
        idempotencyKey: `${ref}:${booking.history.length}`,
        status: result.status, reason: 'cancel' as const,
      };
    } catch (err) {
      // The slot is deliberately still held. Never release what we have not refunded.
      console.error('booking/cancel: refund failed', err);
      await alert('[ALERT] Refund failed on cancellation', [
        `Reference: ${ref}`, `Amount: ${decision.refundPence}p`, `Booker: ${booking.customer.email}`,
        err instanceof PaymentError ? `Code: ${err.code ?? 'unknown'}` : String(err),
        'The booking is STILL CONFIRMED and the slot is still held. Refund by hand in Square,',
        'then cancel from /admin.',
      ]);
      return json({
        error: 'We could not process your refund automatically. Your booking has not been '
          + 'cancelled and we have been alerted — please contact us and we will sort it out.',
      }, 502);
    }
  }

  // 2 — release the room.
  if (booking.calendarEventId && room) {
    try {
      await deleteEvent(room.calendarId, booking.calendarEventId);
    } catch (err) {
      // Refunded but still on the calendar: recoverable, and reconciliation will
      // retry. Not worth failing the cancellation the booker has already been
      // refunded for.
      console.error('booking/cancel: calendar delete failed', err);
      await alert('[ALERT] Cancelled booking still on the calendar', [
        `Reference: ${ref}`, `Room: ${roomName}`, `Event: ${booking.calendarEventId}`,
        'The booker has been refunded. The room is still blocked and must be freed by hand.',
      ]);
    }
  }

  // 3 — record it.
  const updated = await applyChange({
    ref, status: 'cancelled', calendarEventId: null,
    ...(refundEntry ? { payment: refundEntry } : {}),
    history: { action: 'cancelled', actor: 'booker' },
  });

  await revokeTokensFor(ref).catch((err) => console.error('booking/cancel: revoke failed', err));

  const summary = {
    reference: ref, roomName, start, end: booking.end.toDate(),
    durationMins: booking.durationMins, pricePence: booking.pricePence,
    customerName: booking.customer.name, customerEmail: booking.customer.email,
    manageUrl: new URL(`/bookings/${ref}`, url.origin).toString(),
  };
  try {
    await send(cancellationEmail(summary, decision.refundPence));
    if (envBool('BOOKING_NOTIFY_OWNER', true)) await send(ownerNotificationEmail(summary, 'Cancelled'));
  } catch (err) {
    console.error('booking/cancel: email failed', err);
  }

  invalidateRoom(booking.room);
  return json({
    cancelled: true, refundPence: decision.refundPence, paidPence: updated.paidPence,
  });
};
