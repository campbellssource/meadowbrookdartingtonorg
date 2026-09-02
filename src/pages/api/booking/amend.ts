// POST /api/booking/amend — { ref, token, start, durationMins, confirm? }
//
// Time and duration are one operation, deliberately. Building them as two flows
// would mean two price recalculations and two chances to get the money wrong, for
// a change the hirer thinks of as single ("can I move it and make it longer").
//
// Room changes are NOT amendments: different room, different price, different
// calendar. Those are cancel-and-rebook, and the UI says so.

import type { APIRoute } from 'astro';
import { invalidateRoom } from '../../../lib/booking/cache.ts';
import { authorise, BOOKING_HEADERS } from '../../../lib/booking/session.ts';
import { getRoomConfig } from '../../../lib/booking/config-reader.ts';
import { fetchBusyExcluding, updateEvent, createEvent, CalendarError } from '../../../lib/booking/calendar.ts';
import { buildEvent } from '../../../lib/booking/event-format.ts';
import { isBookable } from '../../../lib/booking/availability.ts';
import { priceFor, formatPence } from '../../../lib/booking/pricing.ts';
import { addMinutes, MINUTE } from '../../../lib/booking/time.ts';
import { takeHold, releaseHold, applyChange, SlotUnavailableError } from '../../../lib/booking/store.ts';
import { squareConfig, charge, refund as squareRefund, PaymentError } from '../../../lib/booking/square.ts';
import { refundFor, refundableAtBooking } from '../../../lib/booking/policy.ts';
import { freshenOne } from '../../../lib/booking/reconcile.ts';
import { amendmentEmail, ownerNotificationEmail, alertEmail, send } from '../../../lib/booking/email.ts';
import { envBool } from '../../../lib/booking/env.ts';

export const prerender = false;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...BOOKING_HEADERS },
  });

async function alert(subject: string, lines: string[]): Promise<void> {
  try { await send(alertEmail(subject, lines)); }
  catch (err) { console.error('booking/amend: alert failed', err); }
}

export const POST: APIRoute = async ({ request, url }) => {
  let body: Record<string, any>;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  const ref = String(body.ref ?? '').trim();
  const auth = await authorise(ref, body.token ? String(body.token) : null);
  if (!auth.ok) return json({ error: auth.message }, auth.status);

  // refundFor() reads paidPence, so settle anything pending before deciding what
  // money should move. A stale figure here refunds the wrong amount.
  const { booking: raw } = auth;
  const booking = await freshenOne(ref, raw);
  const now = new Date();
  if (booking.status !== 'confirmed') return json({ error: 'That booking cannot be changed.' }, 409);
  if (booking.start.toDate() <= now) return json({ error: 'That booking has already started.' }, 409);

  // Inside the cancellation window a booking is fixed: no changes, no refund.
  //
  // Without this, amending is a way out of the window rather than a change to a
  // booking. Move a booking that starts in twenty minutes to next week -- at the
  // same price, so no money moves and every other guard passes -- and it is then
  // an hour-plus from its new start, so cancelling refunds in full. The DRA has
  // released a slot twenty minutes before it starts and refunded it. Guarding the
  // refund arithmetic alone would not catch that, because the amendment itself
  // moves no money.
  if (!refundableAtBooking(booking.start.toDate(), now)) {
    return json({
      error: 'This booking starts within the hour, so it can no longer be changed. '
        + 'If you need to move it, please contact us.',
    }, 409);
  }

  const room = await getRoomConfig(booking.room);
  if (!room) return json({ error: 'That room is no longer bookable.' }, 409);

  const startMs = Date.parse(String(body.start ?? ''));
  const durationMins = Number(body.durationMins);
  if (!Number.isFinite(startMs) || !Number.isFinite(durationMins) || durationMins <= 0) {
    return json({ error: 'Invalid new time.' }, 400);
  }
  const start = new Date(startMs);
  const end = addMinutes(start, durationMins);

  const unchanged = start.getTime() === booking.start.toDate().getTime()
    && durationMins === booking.durationMins;
  if (unchanged) return json({ error: 'That is the same time as now.' }, 400);

  const verdict = isBookable(room, start, end, [], now);
  if (!verdict.ok) return json({ error: `That slot cannot be booked (${verdict.reason}).` }, 400);

  const newPrice = priceFor(room, start, end);
  const decision = refundFor({
    paidPence: booking.paidPence, currentPence: booking.pricePence,
    newPence: newPrice, start: booking.start.toDate(), change: 'amend',
  }, now);

  if (body.confirm !== true) {
    return json({
      quote: true, newPricePence: newPrice, paidPence: booking.paidPence,
      chargePence: decision.chargePence, refundPence: decision.refundPence,
      message: decision.chargePence > 0
        ? `You will be charged a further ${formatPence(decision.chargePence)}.`
        : decision.refundPence > 0
          ? `You will be refunded ${formatPence(decision.refundPence)}.`
          : 'The price is unchanged.',
    });
  }

  if (decision.chargePence > 0 && !body.sourceId) {
    return json({ error: 'Card details are needed to pay the difference.' }, 400);
  }

  // Claim the new slot, ignoring this booking's own occupancy in both stores.
  let held;
  try {
    held = await takeHold({ room, start, end, now, excludeRef: ref });
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      return json({ error: 'Sorry — that slot has just been taken. Please choose another.' }, 409);
    }
    throw err;
  }

  try {
    const pad = room.bufferMins;
    const busy = await fetchBusyExcluding(
      room.calendarId, addMinutes(start, -pad), addMinutes(end, pad), booking.calendarEventId,
    );
    const clash = busy.some((b) =>
      start.getTime() - pad * MINUTE < b.end.getTime() && b.start.getTime() < end.getTime() + pad * MINUTE);
    if (clash) {
      await releaseHold(held.holdId);
      return json({ error: 'Sorry — that slot has just been taken. Please choose another.' }, 409);
    }

    const cfg = squareConfig();
    if (!cfg) return json({ error: 'Changes are temporarily unavailable.' }, 500);

    // Dearer: take the money FIRST. If the card fails, nothing has changed and the
    // hirer still has the booking they paid for.
    let paymentEntry;
    if (decision.chargePence > 0) {
      try {
        const result = await charge(cfg, {
          sourceId: String(body.sourceId), amountPence: decision.chargePence,
          idempotencyKey: held.holdId, bookingRef: ref, roomName: room.shortName,
          buyerEmail: booking.customer.email,
          note: `Meadowbrook booking change — ${room.shortName} — ${ref}`,
        });
        paymentEntry = {
          kind: 'charge' as const, amountPence: decision.chargePence,
          squarePaymentId: result.squarePaymentId, squareRefundId: null,
          idempotencyKey: held.holdId, status: result.status, reason: 'amend-up' as const,
        };
      } catch (err) {
        await releaseHold(held.holdId);
        if (err instanceof PaymentError) return json({ error: err.message }, 402);
        throw err;
      }
    }

    // Move the room before refunding. A refund that fails is recoverable by hand;
    // a booking left in limbo between two times is not.
    let calendarEventId = booking.calendarEventId;
    const eventBody = buildEvent({
      room, name: booking.customer.name, phone: booking.customer.phone ?? '',
      email: booking.customer.email, start, end, pricePence: newPrice, reference: ref,
      isTest: process.env.NODE_ENV !== 'production',
    });
    try {
      if (calendarEventId) {
        // Patch rather than delete-and-recreate: it keeps the event id stable and
        // does not spam anyone who already has the entry.
        await updateEvent(room.calendarId, calendarEventId, eventBody);
      } else {
        calendarEventId = (await createEvent(room.calendarId, eventBody)).id;
      }
    } catch (err) {
      console.error('booking/amend: calendar move failed', err);
      await alert('[ALERT] Amended booking not moved on the calendar', [
        `Reference: ${ref}`, `Room: ${room.shortName}`,
        `New time: ${start.toISOString()}`,
        decision.chargePence > 0 ? 'The extra payment HAS been taken.' : 'No money has moved.',
        'The calendar still shows the old time and must be corrected by hand.',
      ]);
    }

    // Cheaper: refund after the move.
    let refundEntry;
    if (decision.refundPence > 0) {
      const charged = booking.payments.find((p) => p.kind === 'charge' && p.status === 'completed');
      if (charged) {
        try {
          const result = await squareRefund(cfg, {
            squarePaymentId: charged.squarePaymentId, amountPence: decision.refundPence,
            idempotencyKey: `${ref}:${booking.history.length}`, reason: 'Booking shortened',
          });
          refundEntry = {
            kind: 'refund' as const, amountPence: decision.refundPence,
            squarePaymentId: charged.squarePaymentId, squareRefundId: result.squareRefundId,
            idempotencyKey: `${ref}:${booking.history.length}`,
            status: result.status, reason: 'amend-down' as const,
          };
        } catch (err) {
          console.error('booking/amend: refund failed', err);
          await alert('[ALERT] Refund failed on amendment', [
            `Reference: ${ref}`, `Amount owed back: ${decision.refundPence}p`,
            `Booker: ${booking.customer.email}`,
            'The booking HAS been moved. Refund by hand in Square.',
          ]);
        }
      }
    }

    const updated = await applyChange({
      ref, start, end, pricePence: newPrice, calendarEventId,
      ...(paymentEntry ? { payment: paymentEntry } : refundEntry ? { payment: refundEntry } : {}),
      history: {
        action: 'amended', actor: 'booker',
        from: booking.start.toDate().toISOString(), to: start.toISOString(),
      },
    });

    await releaseHold(held.holdId);

    const summary = {
      reference: ref, roomName: room.shortName, start, end, durationMins,
      pricePence: newPrice, customerName: booking.customer.name,
      customerEmail: booking.customer.email,
      manageUrl: new URL(`/bookings/${ref}`, url.origin).toString(),
    };
    try {
      await send(amendmentEmail(summary, decision));
      if (envBool('BOOKING_NOTIFY_OWNER', true)) await send(ownerNotificationEmail(summary, 'Amended'));
    } catch (err) { console.error('booking/amend: email failed', err); }

    invalidateRoom(room.slug);
    return json({
      amended: true, start: start.toISOString(), durationMins,
      pricePence: newPrice, paidPence: updated.paidPence,
      chargePence: decision.chargePence, refundPence: decision.refundPence,
    });
  } catch (err) {
    await releaseHold(held.holdId).catch(() => undefined);
    console.error('booking/amend: unexpected failure', err);
    return json({ error: 'Something went wrong. Your booking has not been changed.' },
      err instanceof CalendarError ? 502 : 500);
  }
};
