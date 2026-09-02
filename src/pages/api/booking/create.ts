// POST /api/booking/create — the write path from spec/booking/03.
//
// The ordering is the design. The hold comes before the charge, so the failure
// mode is "a slot is briefly unbookable" rather than "two people paid for one
// room" -- money is the hard thing to reverse. The calendar insert comes after the
// charge, because a calendar event we cannot collect money for silently gives a
// room away, whereas a payment whose calendar event lands late is recoverable.

import type { APIRoute } from 'astro';
import { getRoomConfig } from '../../../lib/booking/config-reader.ts';
import { fetchBusy, createEvent, CalendarError } from '../../../lib/booking/calendar.ts';
import { buildEvent } from '../../../lib/booking/event-format.ts';
import { isBookable } from '../../../lib/booking/availability.ts';
import { priceFor } from '../../../lib/booking/pricing.ts';
import { addMinutes, MINUTE } from '../../../lib/booking/time.ts';
import {
  takeHold, releaseHold, confirmBooking, recordOrphan, recordToken, rateLimit,
  SlotUnavailableError,
} from '../../../lib/booking/store.ts';
import { issue } from '../../../lib/booking/token.ts';
import { squareConfig, charge, PaymentError } from '../../../lib/booking/square.ts';
import { confirmationEmail, ownerNotificationEmail, alertEmail, send } from '../../../lib/booking/email.ts';
import { refundableAtBooking } from '../../../lib/booking/policy.ts';
import { envBool } from '../../../lib/booking/env.ts';

export const prerender = false;

const TERMS_VERSION = '2026-09-01';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Alerts are best-effort: a failed alert must never fail a paid booking. */
async function alert(subject: string, lines: string[]): Promise<void> {
  try { await send(alertEmail(subject, lines)); }
  catch (err) { console.error('booking/create: alert failed', err); }
}

export const POST: APIRoute = async ({ request, url, clientAddress }) => {
  let payload: Record<string, any>;
  try { payload = await request.json(); }
  catch { return json({ error: 'Invalid request.' }, 400); }

  // 1 — validate shape
  const slug = String(payload.room ?? '').trim();
  const startMs = Date.parse(String(payload.start ?? ''));
  const durationMins = Number(payload.durationMins);
  const name = String(payload.customer?.name ?? '').trim().slice(0, 100);
  const email = String(payload.customer?.email ?? '').trim().toLowerCase().slice(0, 254);
  const phone = String(payload.customer?.phone ?? '').trim().slice(0, 20);
  const notes = String(payload.customer?.notes ?? '').trim().slice(0, 1000);
  const sourceId = String(payload.sourceId ?? '').trim();

  if (!slug) return json({ error: 'Missing room.' }, 400);
  if (!Number.isFinite(startMs)) return json({ error: 'Invalid start time.' }, 400);
  if (!Number.isFinite(durationMins) || durationMins <= 0) return json({ error: 'Invalid duration.' }, 400);
  if (name.length < 2) return json({ error: 'Please give your name.' }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);
  if (payload.acceptedTerms !== true) return json({ error: 'Please accept the room hire terms.' }, 400);
  if (!sourceId) return json({ error: 'Payment token missing.' }, 400);

  // Generous enough that a hirer retrying a declined card is never caught, tight
  // enough that scripted abuse is tedious. Applied after validation so malformed
  // requests do not consume anyone's allowance.
  const [byIp, byEmail] = await Promise.all([
    rateLimit(`create:ip:${clientAddress ?? 'unknown'}`, 20, 60),
    rateLimit(`create:email:${email}`, 10, 60),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    console.warn('booking/create: rate limited', { limited: !byIp.allowed ? 'ip' : 'email' });
    return json({ error: 'Too many booking attempts. Please wait a few minutes and try again.' }, 429);
  }

  const room = await getRoomConfig(slug);
  if (!room) return json({ error: 'That room cannot be booked online.' }, 404);

  const start = new Date(startMs);
  const end = addMinutes(start, durationMins);
  const now = new Date();

  // 2 — re-price server-side. The client's figure is never trusted.
  const pricePence = priceFor(room, start, end);
  if (payload.pricePence !== undefined && Number(payload.pricePence) !== pricePence) {
    console.warn('booking/create: client price disagreed', {
      room: slug, client: Number(payload.pricePence), server: pricePence,
    });
  }
  if (pricePence <= 0) return json({ error: 'Could not price that booking.' }, 400);

  // 3 — rules against now
  const verdict = isBookable(room, start, end, [], now);
  if (!verdict.ok) {
    const messages: Record<string, string> = {
      'too-soon': 'That start time has passed. Please pick another.',
      'too-far-ahead': `Bookings can only be made up to ${room.maxAdvanceDays} days ahead.`,
      'not-on-grid': 'Bookings must start on the hour, quarter past, half past or quarter to.',
      'too-short': `The minimum booking is ${room.minDurationMins} minutes.`,
      'too-long': 'That booking is too long.',
      'bad-duration': 'Please choose one of the offered lengths.',
      'before-opening': 'That is before the room opens.',
      'after-closing': 'That would run past closing time.',
      closed: 'The room is closed that day.',
    };
    return json({ error: messages[verdict.reason] ?? 'That slot cannot be booked.' }, 400);
  }

  const squareCfg = squareConfig();
  if (!squareCfg) {
    console.error('booking/create: Square is not configured');
    return json({ error: 'Bookings are temporarily unavailable. Please try again later.' }, 500);
  }

  // 4 — claim the slot before touching money
  let held;
  try {
    held = await takeHold({ room, start, end, now });
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      return json({ error: 'Sorry — that slot has just been taken. Please choose another.' }, 409);
    }
    console.error('booking/create: hold failed', err);
    return json({ error: 'Could not reserve that slot. Please try again.' }, 500);
  }

  const { holdId, bookingRef } = held;

  try {
    // 5 — the calendar is the source of truth, and the transaction cannot see it.
    // Catches a committee block created since the availability response was built.
    const pad = room.bufferMins;
    const busy = await fetchBusy(room.calendarId, addMinutes(start, -pad), addMinutes(end, pad));
    const clash = busy.some((b) =>
      start.getTime() - pad * MINUTE < b.end.getTime() && b.start.getTime() < end.getTime() + pad * MINUTE);
    if (clash) {
      await releaseHold(holdId);
      return json({ error: 'Sorry — that slot has just been taken. Please choose another.' }, 409);
    }

    // 6 — charge. Idempotency key is the hold, so a replayed request cannot
    // charge twice.
    let payment;
    try {
      payment = await charge(squareCfg, {
        sourceId, amountPence: pricePence, idempotencyKey: holdId,
        bookingRef, roomName: room.shortName, buyerEmail: email,
      });
    } catch (err) {
      await releaseHold(holdId);
      if (err instanceof PaymentError) {
        await alert('[FAIL] Payment declined', [
          `Room: ${room.shortName}`, `When: ${start.toISOString()}`,
          `Amount: ${pricePence}p`, `Code: ${err.code ?? 'unknown'}`,
          `Category: ${err.category ?? 'unknown'}`, `Booker: ${email}`,
        ]);
        return json({ error: err.message }, 402);
      }
      throw err;
    }

    // 7 — the money is real from here on. Nothing below may lose the booking.
    let booking;
    try {
      booking = await confirmBooking({
        bookingRef, holdId, room, start, end, pricePence,
        customer: { name, email, ...(phone ? { phone } : {}), ...(notes ? { notes } : {}) },
        payment: {
          kind: 'charge', amountPence: pricePence,
          squarePaymentId: payment.squarePaymentId, squareRefundId: null,
          idempotencyKey: holdId, status: payment.status, reason: 'initial',
        },
        calendarEventId: null,
        termsVersion: TERMS_VERSION,
      });
    } catch (err) {
      // Charged with nothing to show for it: the worst state available. Record it
      // so reconciliation and a human can both find it.
      console.error('booking/create: charged but could not write booking', err);
      await recordOrphan(bookingRef, {
        squarePaymentId: payment.squarePaymentId, amountPence: pricePence, email,
        room: slug, start: start.toISOString(),
      }).catch(() => undefined);
      await alert('[ALERT] Charged but no booking record', [
        `Reference: ${bookingRef}`, `Square payment: ${payment.squarePaymentId}`,
        `Amount: ${pricePence}p`, `Booker: ${email}`,
        'ACTION: complete the booking by hand or refund.',
      ]);
      return json({
        error: 'Your payment went through but we could not finish the booking. '
          + 'We have been alerted and will contact you shortly.',
        reference: bookingRef,
      }, 500);
    }

    // 8 — calendar event. A failure here must not tell the booker anything is
    // wrong: they have paid and the room is theirs. Reconciliation retries.
    let calendarEventId: string | null = null;
    try {
      const event = await createEvent(room.calendarId, buildEvent({
        room, name, phone: phone || '', email, start, end, pricePence,
        reference: bookingRef, isTest: process.env.NODE_ENV !== 'production',
      }));
      calendarEventId = event.id;
      const { getDb } = await import('../../../lib/booking/store.ts');
      await (await getDb()).collection('bookings').doc(bookingRef)
        .update({ calendarEventId, updatedAt: new Date() });
    } catch (err) {
      console.error('booking/create: calendar event failed', err);
      await alert('[ALERT] Booking has no calendar event', [
        `Reference: ${bookingRef}`, `Room: ${room.shortName}`,
        `When: ${start.toISOString()}`,
        'The booking is paid and confirmed. The room is NOT blocked on the calendar,',
        'and no door code will have been issued. Reconciliation will retry.',
      ]);
    }

    // 9 — issue the magic link, then email. Both best-effort: a failure here must
    // not fail a paid booking, and /bookings/find can re-issue a link later.
    let manageUrl = new URL(`/bookings/${bookingRef}`, url.origin).toString();
    try {
      const { token, jti } = issue(bookingRef, email, end);
      await recordToken(jti, bookingRef, email);
      manageUrl = `${manageUrl}?t=${token}`;
    } catch (err) {
      console.error('booking/create: could not issue magic link', err);
      await alert('[ALERT] Booking has no manage link', [
        `Reference: ${bookingRef}`, `Booker: ${email}`,
        'The booking is paid and confirmed but the booker cannot self-serve.',
        'They can request a link at /bookings/find.',
      ]);
    }
    const summary = {
      reference: bookingRef, roomName: room.shortName, start, end, durationMins,
      pricePence, customerName: name, customerEmail: email, manageUrl,
      capacityNote: room.capacityNote,
      nonRefundable: !refundableAtBooking(start, now),
    };
    try {
      await send(confirmationEmail(summary));
      if (envBool('BOOKING_NOTIFY_OWNER', true)) {
        await send(ownerNotificationEmail(summary, 'New'));
      }
    } catch (err) {
      console.error('booking/create: confirmation email failed', err);
      await alert('[ALERT] Confirmation email not sent', [
        `Reference: ${bookingRef}`, `Booker: ${email}`,
        'The booking is paid and confirmed but the booker has no email.',
      ]);
    }

    // 10
    return json({ bookingRef, manageUrl, pricePence, calendarEventId }, 201);
  } catch (err) {
    await releaseHold(holdId).catch(() => undefined);
    const status = err instanceof CalendarError ? 502 : 500;
    console.error('booking/create: unexpected failure', err);
    return json({ error: 'Something went wrong. No payment has been taken.' }, status);
  }
};
