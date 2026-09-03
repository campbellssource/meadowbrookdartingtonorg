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
import { applyChange, revokeTokensFor, isImported } from '../../../lib/booking/store.ts';
import { squareConfig, PaymentError } from '../../../lib/booking/square.ts';
import { issueRefund } from '../../../lib/booking/refunds.ts';
import { refundFor } from '../../../lib/booking/policy.ts';
import { freshenOne } from '../../../lib/booking/reconcile.ts';
import { formatPence } from '../../../lib/booking/pricing.ts';
import { cancellationEmail, ownerNotificationEmail, alertEmail, send } from '../../../lib/booking/email.ts';
import { envBool, canonicalOrigin } from '../../../lib/booking/env.ts';

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
  // Imported history (`17`). No calendar event of ours to delete and no payment of
  // ours to refund -- a refund here would be attempted against a Square payment that
  // was never in our account.
  if (isImported(booking)) {
    return json({
      error: 'This booking was made in our previous booking system, so it cannot be cancelled '
        + 'here. Please email bookings@meadowbrookdartington.org and we will sort it out.',
    }, 409);
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
      // The no-refund branch covers two different situations, and telling someone
      // their booking "starts within the hour" when it finished yesterday reads as
      // a bug in the system rather than a policy.
      message: decision.refundPence > 0
        ? `You will be refunded ${formatPence(decision.refundPence)}.`
        : start <= now
          ? 'This booking has already started, so no refund is due.'
          : 'This booking starts within the hour, so no refund is due.',
    });
  }

  const room = await getRoomConfig(booking.room);
  const roomName = room?.shortName ?? booking.room;

  // 1 — money first.
  let refundEntries: Awaited<ReturnType<typeof issueRefund>>['entries'] = [];
  if (decision.refundPence > 0) {
    const cfg = squareConfig();
    if (!cfg) {
      console.error('booking/cancel: Square not configured');
      return json({ error: 'Cancellation is temporarily unavailable. Please contact us.' }, 500);
    }
    // Spread across every charge holding money. An amended-upwards booking has more
    // than one, and refunding the total against the first is what Square refuses.
    const outcome = await issueRefund(cfg, {
      ref, payments: booking.payments, amountPence: decision.refundPence,
      historyLength: booking.history.length,
      reason: 'Booking cancelled by customer', ledgerReason: 'cancel',
    });

    if (!outcome.ok) {
      // The slot is deliberately still held. Never release what we have not refunded.
      console.error('booking/cancel: refund failed', outcome.error);
      const err = outcome.error;
      await alert('[ALERT] Refund failed on cancellation', [
        `Reference: ${ref}`, `Amount: ${decision.refundPence}p`, `Booker: ${booking.customer.email}`,
        err instanceof PaymentError ? `Code: ${err.code ?? 'unknown'}` : String(err),
        ...(outcome.refundedPence > 0
          ? [`PARTIAL: ${outcome.refundedPence}p of ${decision.refundPence}p was refunded and is`,
             'recorded on the booking. Only the remainder needs refunding by hand.']
          : ['No money has moved.']),
        'The booking is STILL CONFIRMED and the slot is still held. Refund by hand in Square,',
        'then cancel from /admin.',
      ]);
      // Whatever did go through is written to the ledger before failing: the money
      // has left Square regardless, and a refund missing from the ledger reads as
      // drift to reconciliation and as an overcharge to the booker.
      if (outcome.entries.length) {
        await applyChange({
          ref, payments: outcome.entries,
          history: { action: `partial refund ${outcome.refundedPence}p on failed cancellation`, actor: 'system' },
        }).catch((e) => console.error('booking/cancel: could not record partial refund', e));
      }
      return json({
        error: 'We could not process your refund automatically. Your booking has not been '
          + 'cancelled and we have been alerted — please contact us and we will sort it out.',
      }, 502);
    }
    refundEntries = outcome.entries;
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
    ...(refundEntries.length ? { payments: refundEntries } : {}),
    history: { action: 'cancelled', actor: 'booker' },
  });

  await revokeTokensFor(ref).catch((err) => console.error('booking/cancel: revoke failed', err));

  const summary = {
    reference: ref, roomName, start, end: booking.end.toDate(),
    durationMins: booking.durationMins, pricePence: booking.pricePence,
    customerName: booking.customer.name, customerEmail: booking.customer.email,
    manageUrl: new URL(`/bookings/${ref}`, canonicalOrigin(url.origin)).toString(),
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
