// Making our records agree with Square and with the calendar.
//
// The webhook (`webhooks/square.ts`) is the fast path; this is the one that has to
// be right. Webhooks get missed -- a deploy mid-flight, a delivery failure, a
// signature key rotated at the wrong moment -- and a missed `refund.updated` would
// otherwise leave a ledger entry pending forever, with `paidPence` overstating
// what the DRA holds for the life of the booking.
//
// So everything here is written to be safe to run repeatedly, and the hourly job
// covers exactly the same ground the webhook does. If the webhook never fired at
// all, the books would still come right within the hour.

import { Timestamp } from '@google-cloud/firestore';
import { getDb } from './store.ts';
import type { Booking, Payment } from './store.ts';
import { squareConfig } from './square.ts';
import { getEvent, createEvent } from './calendar.ts';
import { buildEvent } from './event-format.ts';
import { getRoomConfig } from './config-reader.ts';
import { alertEmail, send } from './email.ts';

const SQUARE_BASE = (env: string) =>
  env === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';

async function squareGet(path: string): Promise<Record<string, any> | null> {
  const cfg = squareConfig();
  if (!cfg) return null;
  const res = await fetch(`${SQUARE_BASE(cfg.environment)}${path}`, {
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      'Square-Version': '2024-01-17',
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    console.warn('reconcile: square read failed', { path, status: res.status });
    return null;
  }
  return res.json();
}

/** Square's `COMPLETED`/`PENDING`/`FAILED` in our vocabulary. */
function mapStatus(squareStatus: string | undefined): Payment['status'] | null {
  switch (squareStatus) {
    case 'COMPLETED': case 'APPROVED': return 'completed';
    case 'PENDING': return 'pending';
    case 'FAILED': case 'CANCELED': case 'REJECTED': return 'failed';
    default: return null;
  }
}

export interface SettleInput {
  bookingRef: string | null;
  squarePaymentId: string | null;
  squareRefundId: string | null;
}

/**
 * Brings one booking's ledger entries into line with Square.
 *
 * Idempotent: an entry already matching Square is left untouched, so replaying a
 * webhook or re-running the sweep changes nothing.
 */
export async function settlePayment(input: SettleInput): Promise<'updated' | 'unchanged' | 'unknown'> {
  const db = await getDb();
  let ref = input.bookingRef;

  // A refund webhook may not carry the reference; find the booking by payment id.
  if (!ref && input.squarePaymentId) {
    const snap = await db.collection('bookings').get();
    const hit = snap.docs.find((d) =>
      (d.data() as Booking).payments.some((p) => p.squarePaymentId === input.squarePaymentId));
    ref = hit?.id ?? null;
  }
  if (!ref) return 'unknown';

  const docRef = db.collection('bookings').doc(ref);
  const snap = await docRef.get();
  if (!snap.exists) return 'unknown';
  const booking = snap.data() as Booking;

  const payments: Payment[] = [];
  let changed = false;

  for (const p of booking.payments) {
    if (p.status !== 'pending') { payments.push(p); continue; }

    let current: string | undefined;
    if (p.kind === 'refund' && p.squareRefundId) {
      current = (await squareGet(`/v2/refunds/${p.squareRefundId}`))?.refund?.status;
    } else if (p.kind === 'charge' && p.squarePaymentId) {
      current = (await squareGet(`/v2/payments/${p.squarePaymentId}`))?.payment?.status;
    }

    const mapped = mapStatus(current);
    if (mapped && mapped !== p.status) {
      payments.push({ ...p, status: mapped });
      changed = true;
      console.log('reconcile: settled', { ref, kind: p.kind, from: p.status, to: mapped });
    } else {
      payments.push(p);
    }
  }

  if (!changed) return 'unchanged';

  const paidPence = payments.reduce((sum, p) => {
    if (p.status !== 'completed') return sum;
    return p.kind === 'charge' ? sum + p.amountPence : sum - p.amountPence;
  }, 0);

  await docRef.update({
    payments, paidPence, updatedAt: Timestamp.now(),
    history: [...booking.history, { at: Timestamp.now(), action: 'payments settled', actor: 'system' }],
  });
  return 'updated';
}

/**
 * Brings any pending ledger entries up to date for the given bookings, right now.
 *
 * `paidPence` is not merely displayed -- it is an input to `refundFor()`, so a
 * stale one computes the wrong refund on a cancellation or a shortening, and caps
 * the admin refund box wrongly. Anywhere a money decision is about to be made from
 * it is worth a fresh read.
 *
 * Cheap in the normal case: bookings with nothing pending make no API call at all,
 * and pending entries are rare and short-lived. Bounded and best-effort so that
 * Square being slow or down degrades freshness rather than breaking the page.
 */
export async function freshenPending(
  bookings: { ref: string; booking: Booking }[], limit = 20,
): Promise<Set<string>> {
  const stale = bookings
    .filter(({ booking }) => booking.payments?.some((p) => p.status === 'pending'))
    .slice(0, limit);
  if (stale.length === 0) return new Set();

  const updated = new Set<string>();
  await Promise.all(stale.map(async ({ ref }) => {
    try {
      const result = await settlePayment({ bookingRef: ref, squarePaymentId: null, squareRefundId: null });
      if (result === 'updated') updated.add(ref);
    } catch (err) {
      // Freshness is a nicety here; the hourly sweep is the guarantee.
      console.warn('freshenPending: could not settle', { ref, err: String(err) });
    }
  }));
  if (updated.size > 0) console.log('freshenPending: settled', { count: updated.size });
  return updated;
}

/**
 * Freshens one booking before a refund is calculated from it.
 *
 * Returns the booking as it now stands. Called on the cancel and amend paths
 * because `refundFor()` reads `paidPence`: with a pending refund uncounted, a
 * cancellation would try to return money that has already gone back, and a
 * shortening would refund more than the difference.
 */
export async function freshenOne(ref: string, booking: Booking): Promise<Booking> {
  if (!booking.payments?.some((p) => p.status === 'pending')) return booking;
  try {
    if (await settlePayment({ bookingRef: ref, squarePaymentId: null, squareRefundId: null }) !== 'updated') {
      return booking;
    }
    const db = await getDb();
    const snap = await db.collection('bookings').doc(ref).get();
    return snap.exists ? (snap.data() as Booking) : booking;
  } catch (err) {
    console.warn('freshenOne: could not settle', { ref, err: String(err) });
    return booking;
  }
}

export interface ReconcileReport {
  settled: number;
  calendarRepaired: number;
  calendarFailed: number;
  abandoned: number;
  needsReview: string[];
}

/**
 * The hourly sweep.
 *
 * Four jobs, deliberately in one place: settle pending money, put back calendar
 * events that never got written, report abandoned checkouts, and flag anything
 * that cannot be fixed automatically.
 */
export async function reconcile(now = new Date()): Promise<ReconcileReport> {
  const db = await getDb();
  const report: ReconcileReport = {
    settled: 0, calendarRepaired: 0, calendarFailed: 0, abandoned: 0, needsReview: [],
  };

  // 1 — pending money, whether or not a webhook ever arrived.
  const all = await db.collection('bookings').get();
  for (const doc of all.docs) {
    const b = doc.data() as Booking;
    if (!b.payments?.some((p) => p.status === 'pending')) continue;
    const result = await settlePayment({ bookingRef: doc.id, squarePaymentId: null, squareRefundId: null });
    if (result === 'updated') report.settled += 1;
  }

  // 2 — confirmed bookings with no calendar event. The hirer has paid and the room
  // is not blocked, so this is the most urgent thing the sweep does.
  for (const doc of all.docs) {
    const b = doc.data() as Booking;
    if (b.status !== 'confirmed') continue;
    if (b.end.toDate() < now) continue;

    let needsEvent = !b.calendarEventId;
    const room = await getRoomConfig(b.room);
    if (!room) { report.needsReview.push(`${doc.id}: room ${b.room} no longer configured`); continue; }

    if (b.calendarEventId) {
      // Deleted from the calendar by hand: the room is free but the booking is not.
      const existing = await getEvent(room.calendarId, b.calendarEventId).catch(() => null);
      if (existing === null) needsEvent = true;
    }
    if (!needsEvent) continue;

    try {
      const event = await createEvent(room.calendarId, buildEvent({
        room, name: b.customer.name, phone: b.customer.phone ?? '', email: b.customer.email,
        start: b.start.toDate(), end: b.end.toDate(), pricePence: b.pricePence,
        reference: doc.id, isTest: process.env.NODE_ENV !== 'production',
      }));
      await doc.ref.update({
        calendarEventId: event.id, updatedAt: Timestamp.now(),
        history: [...b.history, { at: Timestamp.now(), action: 'calendar event restored', actor: 'system' }],
      });
      report.calendarRepaired += 1;
      console.log('reconcile: restored calendar event', { ref: doc.id });
    } catch (err) {
      report.calendarFailed += 1;
      report.needsReview.push(`${doc.id}: could not restore calendar event`);
      console.error('reconcile: calendar restore failed', { ref: doc.id, err: String(err) });
    }
  }

  // 3 — abandoned checkouts. The hold has lapsed, nothing was paid, and the record
  // survives 24h precisely so this can be reported before TTL removes it (`06`).
  const holds = await db.collection('holds').get();
  const abandoned: string[] = [];
  for (const doc of holds.docs) {
    const h = doc.data() as { holdExpiresAt: Timestamp; abandonedReportedAt: Timestamp | null; room: string; start: Timestamp };
    if (h.abandonedReportedAt) continue;
    if (h.holdExpiresAt.toDate() > now) continue;
    abandoned.push(`${h.room} ${h.start.toDate().toISOString().slice(0, 16).replace('T', ' ')}`);
    await doc.ref.update({ abandonedReportedAt: Timestamp.fromDate(now) });
  }
  report.abandoned = abandoned.length;

  // One digest rather than one email per event: an hour of abandonments is one
  // message, and a run of them is the signal worth seeing.
  if (abandoned.length > 0) {
    await send(alertEmail('[ABANDONED] Checkouts not completed', [
      `${abandoned.length} slot(s) were held and never paid for in the last hour:`,
      '', ...abandoned, '',
      'A few is normal. A sudden run of them usually means the payment form is broken.',
    ])).catch((err) => console.error('reconcile: abandoned alert failed', err));
  }

  if (report.needsReview.length > 0) {
    await send(alertEmail('[ALERT] Bookings needing attention', [
      'These could not be reconciled automatically:', '', ...report.needsReview,
    ])).catch((err) => console.error('reconcile: review alert failed', err));
  }

  return report;
}
