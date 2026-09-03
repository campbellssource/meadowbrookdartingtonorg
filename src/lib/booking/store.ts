// Firestore access for bookings and holds.
//
// The important thing in this file is `takeHold`: the transaction that stops two
// people paying for the same slot. Everything else is bookkeeping around it.
//
// Firestore is not the source of truth for occupancy -- the calendar is (D1). This
// store answers a narrower question: has *this system* already promised the slot
// to someone in the last few minutes? A calendar read cannot answer that, because
// the competing booking has not reached the calendar yet.

import { Firestore, Timestamp, type Settings } from '@google-cloud/firestore';
import { GoogleAuth, Impersonated } from 'google-auth-library';
import { generateReference } from './reference.ts';
import { inflate } from './availability.ts';
import { instantToLocalDate, MINUTE } from './time.ts';
import type { Interval, LocalDate } from './time.ts';
import type { RoomBookingConfig } from './config.ts';
import { env } from './env.ts';

export type BookingStatus = 'held' | 'confirmed' | 'cancelled' | 'orphaned';

export interface Payment {
  at: Timestamp;
  kind: 'charge' | 'refund';
  amountPence: number;
  squarePaymentId: string;
  squareRefundId: string | null;
  idempotencyKey: string;
  status: 'completed' | 'pending' | 'failed';
  reason: string | null;
}

export interface HistoryEntry {
  at: Timestamp;
  action: string;
  from?: string;
  to?: string;
  actor: 'booker' | 'admin' | 'system';
}

export interface Customer {
  name: string; email: string; phone?: string; organisation?: string; notes?: string;
}

export interface Booking {
  room: string;
  /**
   * Which system took the booking. Absent means 'meadowbrook' -- bookings predate
   * the field. `acuity` records were imported for reporting history only: there is
   * no calendar event of ours to move and no payment of ours to refund, so amend,
   * cancel, refunds, reminders and magic links all refuse them. See `17`.
   */
  source?: 'meadowbrook' | 'acuity';
  /** Provenance for imported rows, so an oddity can be traced back to the export. */
  acuity?: {
    appointmentId: string;
    /** What Acuity actually collected online, which is not always the price. */
    paidOnlinePence: number;
    paid: boolean;
    type: string;
  };
  status: BookingStatus;
  start: Timestamp;
  end: Timestamp;
  localDate: LocalDate;
  durationMins: number;
  pricePence: number;
  paidPence: number;
  customer: Customer;
  calendarEventId: string | null;
  payments: Payment[];
  seriesId: string | null;
  termsVersion: string;
  /**
   * Consent to the newsletter, captured at booking. Evidence of what was agreed on
   * the day -- not a live subscription state. Someone who later unsubscribes is
   * unsubscribed in Brevo, and this record stays true about what they ticked. Absent
   * on bookings made before the checkbox existed, which is different from `false`.
   */
  newsletter?: { optIn: boolean; at: Timestamp; wording: string };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  history: HistoryEntry[];
  /**
   * Set outside production, so cleanup can find test bookings without trusting a
   * list of references someone remembered to keep. Same principle as the calendar's
   * [TEST EVENT] marker: the record says what it is.
   */
  isTest?: boolean;
}

export interface Hold {
  room: string;
  localDate: LocalDate;
  start: Timestamp;
  end: Timestamp;
  bookingRef: string;
  /** When the slot is released back to other people. Minutes. */
  holdExpiresAt: Timestamp;
  /**
   * When the *record* is deleted, by the Firestore TTL policy. A day.
   *
   * Two timestamps rather than one because TTL deletion is silent: if the record
   * vanished the moment the slot was released, there would be nothing left for the
   * reconcile job to report as an abandoned checkout (`06`).
   */
  expiresAt: Timestamp;
  abandonedReportedAt: Timestamp | null;
}

/** How long a slot is held while the booker enters card details. */
export const HOLD_MINUTES = 5;
/** How long the hold *record* survives, for abandoned-checkout reporting. */
export const HOLD_RECORD_HOURS = 24;

let db: Firestore | null = null;

export async function getDb(): Promise<Firestore> {
  if (db) return db;
  const projectId = env('BOOKING_PROJECT_ID') ?? 'meadowbrook-booking';
  const settings: Settings = { projectId };

  // Impersonation is required in BOTH environments, which is easy to get wrong.
  //
  // The Cloud Run runtime SA (589136616970-compute@developer) has no access to the
  // meadowbrook-booking project at all: `booking-app` holds roles/datastore.user
  // and is the identity the room calendars are shared with. The runtime SA is only
  // granted serviceAccountTokenCreator on it. So production must set
  // BOOKING_IMPERSONATE_SA too -- leaving it unset does not fall back to a working
  // identity, it falls back to one with no permissions, and every read fails.
  //
  // Locally the same variable impersonates through your own ADC, because the
  // Workspace blocks service-account keys. One code path, one identity, both
  // environments.
  const target = env('BOOKING_IMPERSONATE_SA');
  if (target && !env('FIRESTORE_EMULATOR_HOST')) {
    const sourceClient = await new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    }).getClient();
    (settings as Record<string, unknown>).authClient = new Impersonated({
      sourceClient, targetPrincipal: target, lifetime: 3600, delegates: [],
      targetScopes: ['https://www.googleapis.com/auth/datastore'],
    });
  }
  db = new Firestore(settings);
  return db;
}

/** Test seam. */
export function resetDb(): void { db = null; }

export class SlotUnavailableError extends Error {
  constructor(message = 'That slot has just been taken.') {
    super(message);
    this.name = 'SlotUnavailableError';
  }
}

const toInterval = (d: { start: Timestamp; end: Timestamp }): Interval =>
  ({ start: d.start.toDate(), end: d.end.toDate() });

/**
 * Everything this system has already promised for a room on a London date:
 * confirmed bookings, and holds that have not yet lapsed.
 *
 * Equality filters only, deliberately. Adding `where('holdExpiresAt','>',now)`
 * would turn this into equality-plus-inequality and demand a composite index for
 * a collection that holds a handful of documents per room per day. Filtering
 * expiry in memory costs nothing and keeps the index configuration empty.
 */
async function promisedIntervals(
  tx: FirebaseFirestore.Transaction, room: string, localDate: LocalDate, now: Date,
  excludeRef?: string,
): Promise<Interval[]> {
  const database = await getDb();
  const [bookingSnap, holdSnap] = await Promise.all([
    tx.get(database.collection('bookings').where('room', '==', room).where('localDate', '==', localDate)),
    tx.get(database.collection('holds').where('room', '==', room).where('localDate', '==', localDate)),
  ]);

  const out: Interval[] = [];
  for (const doc of bookingSnap.docs) {
    // A booking being amended must not block itself.
    if (excludeRef && doc.id === excludeRef) continue;
    const b = doc.data() as Booking;
    if (b.status === 'held' || b.status === 'confirmed') out.push(toInterval(b));
  }
  for (const doc of holdSnap.docs) {
    const h = doc.data() as Hold;
    if (h.holdExpiresAt.toDate().getTime() > now.getTime()) out.push(toInterval(h));
  }
  return out;
}

export interface TakeHoldInput {
  room: RoomBookingConfig;
  start: Date;
  end: Date;
  now?: Date;
  /** Set when amending: the booking being moved must not block its own move. */
  excludeRef?: string;
}

export interface HeldSlot { holdId: string; bookingRef: string; expiresAt: Date }

/**
 * Claims a slot, or throws `SlotUnavailableError`.
 *
 * The whole point of the transaction: two requests for the same slot both read
 * the same empty set, both decide the slot is free, and both write. Firestore
 * aborts and retries the loser, which then reads the winner's hold and fails
 * properly -- one 201, one 409, and crucially only one card charge, because the
 * hold is taken *before* Square is called.
 *
 * The room's buffer is applied here as well as in availability, so a slot 15
 * minutes after a Studio booking is refused at the point of purchase even if a
 * stale page offered it.
 */
export async function takeHold(input: TakeHoldInput): Promise<HeldSlot> {
  const { room, start, end } = input;
  const now = input.now ?? new Date();
  const database = await getDb();
  const localDate = instantToLocalDate(start);
  const bookingRef = generateReference();
  const holdRef = database.collection('holds').doc();

  await database.runTransaction(async (tx) => {
    const promised = await promisedIntervals(tx, room.slug, localDate, now, input.excludeRef);
    const blocked = inflate(promised, room.bufferMins);
    for (const b of blocked) {
      if (start.getTime() < b.end.getTime() && b.start.getTime() < end.getTime()) {
        throw new SlotUnavailableError();
      }
    }
    const hold: Hold = {
      room: room.slug,
      localDate,
      start: Timestamp.fromDate(start),
      end: Timestamp.fromDate(end),
      bookingRef,
      holdExpiresAt: Timestamp.fromDate(new Date(now.getTime() + HOLD_MINUTES * MINUTE)),
      expiresAt: Timestamp.fromDate(new Date(now.getTime() + HOLD_RECORD_HOURS * 60 * MINUTE)),
      abandonedReportedAt: null,
    };
    tx.create(holdRef, hold);
  });

  return {
    holdId: holdRef.id,
    bookingRef,
    expiresAt: new Date(now.getTime() + HOLD_MINUTES * MINUTE),
  };
}

export async function releaseHold(holdId: string): Promise<void> {
  const database = await getDb();
  await database.collection('holds').doc(holdId).delete().catch(() => undefined);
}

export interface ConfirmInput {
  bookingRef: string;
  holdId: string;
  room: RoomBookingConfig;
  start: Date;
  end: Date;
  pricePence: number;
  customer: Customer;
  payment: Omit<Payment, 'at'>;
  calendarEventId: string | null;
  termsVersion: string;
  newsletterOptIn?: boolean;
  newsletterWording?: string;
}

/** Turns a paid hold into a booking, and releases the hold, in one write. */
export async function confirmBooking(input: ConfirmInput): Promise<Booking> {
  const database = await getDb();
  const now = Timestamp.now();
  const booking: Booking = {
    room: input.room.slug,
    source: 'meadowbrook',
    status: 'confirmed',
    start: Timestamp.fromDate(input.start),
    end: Timestamp.fromDate(input.end),
    localDate: instantToLocalDate(input.start),
    durationMins: Math.round((input.end.getTime() - input.start.getTime()) / MINUTE),
    pricePence: input.pricePence,
    paidPence: input.payment.status === 'completed' ? input.payment.amountPence : 0,
    customer: input.customer,
    calendarEventId: input.calendarEventId,
    payments: [{ ...input.payment, at: now }],
    seriesId: null,
    termsVersion: input.termsVersion,
    ...(input.newsletterOptIn === undefined ? {} : {
      newsletter: {
        optIn: input.newsletterOptIn,
        at: now,
        wording: input.newsletterWording ?? '',
      },
    }),
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, action: 'created', actor: 'booker' }],
    ...(process.env.NODE_ENV !== 'production' ? { isTest: true } : {}),
  };

  const batch = database.batch();
  batch.create(database.collection('bookings').doc(input.bookingRef), booking);
  batch.delete(database.collection('holds').doc(input.holdId));
  await batch.commit();
  return booking;
}

export async function getBooking(ref: string): Promise<Booking | null> {
  const database = await getDb();
  const doc = await database.collection('bookings').doc(ref).get();
  return doc.exists ? (doc.data() as Booking) : null;
}

/**
 * Records a payment that succeeded against a booking we then failed to write.
 *
 * Money has moved and nothing references it, which is the worst state this system
 * can reach. Writing it down under its own status is what lets the reconcile job
 * (`08`) find it and the DRA refund it.
 */
export async function recordOrphan(
  bookingRef: string, detail: Record<string, unknown>,
): Promise<void> {
  const database = await getDb();
  await database.collection('bookings').doc(bookingRef).set({
    status: 'orphaned' as BookingStatus,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    orphanDetail: detail,
  }, { merge: true });
}

// --- Magic-link tokens ---------------------------------------------------

export interface TokenRecord {
  ref: string;
  email: string;
  issuedAt: Timestamp;
  revokedAt: Timestamp | null;
  /** Rolling one-hour window for the use limit. */
  windowStart: Timestamp;
  uses: number;
}

/** Uses allowed per token per hour. A leaked link becomes noisy rather than useful. */
export const TOKEN_USES_PER_HOUR = 20;

export async function recordToken(jti: string, ref: string, email: string): Promise<void> {
  const database = await getDb();
  const now = Timestamp.now();
  await database.collection('tokens').doc(jti).set({
    ref, email, issuedAt: now, revokedAt: null, windowStart: now, uses: 0,
  } satisfies TokenRecord);
}

/** Revokes every token for a booking. Used on cancellation and on re-issue. */
export async function revokeTokensFor(ref: string): Promise<number> {
  const database = await getDb();
  const snap = await database.collection('tokens').where('ref', '==', ref).get();
  const live = snap.docs.filter((d) => (d.data() as TokenRecord).revokedAt === null);
  if (live.length === 0) return 0;
  const batch = database.batch();
  for (const doc of live) batch.update(doc.ref, { revokedAt: Timestamp.now() });
  await batch.commit();
  return live.length;
}

export type TokenCheck =
  | { ok: true }
  | { ok: false; reason: 'unknown' | 'revoked' | 'rate-limited' };

/**
 * Checks a token against its stored record and counts the use.
 *
 * The counter is incremented inside a transaction rather than read-then-written,
 * so hammering the link cannot race past the limit.
 */
export async function useToken(jti: string, now = new Date()): Promise<TokenCheck> {
  const database = await getDb();
  const ref = database.collection('tokens').doc(jti);
  return database.runTransaction(async (tx): Promise<TokenCheck> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: 'unknown' };
    const rec = snap.data() as TokenRecord;
    if (rec.revokedAt) return { ok: false, reason: 'revoked' };

    const windowAge = now.getTime() - rec.windowStart.toDate().getTime();
    if (windowAge > 3_600_000) {
      tx.update(ref, { windowStart: Timestamp.fromDate(now), uses: 1 });
      return { ok: true };
    }
    if (rec.uses >= TOKEN_USES_PER_HOUR) return { ok: false, reason: 'rate-limited' };
    tx.update(ref, { uses: rec.uses + 1 });
    return { ok: true };
  });
}

/**
 * Whether the reconcile sweep may recreate this booking's calendar event.
 *
 * Lives here rather than in reconcile.ts so it can be tested without dragging the
 * Keystatic reader into the test runner -- and it is worth testing, because getting
 * it wrong writes to a live calendar, and writing a calendar event is what
 * provisions a door passcode.
 *
 * Imported Acuity bookings are the trap: `calendarEventId` is null by design, since
 * the event already exists and was written by Acuity years ago. Read naively that
 * null says "the hirer has paid and the room is not blocked". On 3 Sep 2026 the
 * sweep duplicated the two future imports minutes after the backfill.
 */
export function eligibleForCalendarRestore(
  b: Pick<Booking, 'status' | 'end' | 'source'>, now: Date,
): boolean {
  if (b.status !== 'confirmed') return false;
  if (b.end.toDate() < now) return false;
  if (b.source === 'acuity') return false;
  return true;
}

/** A booking imported from Acuity: history, not something this system can act on. */
export const isImported = (b: Pick<Booking, 'source'>): boolean => b.source === 'acuity';

/** Bookings for an email address that have not yet ended. Powers /bookings/find. */
export async function upcomingBookingsFor(email: string, now = new Date()): Promise<
  { ref: string; booking: Booking }[]
> {
  const database = await getDb();
  const snap = await database.collection('bookings')
    .where('customer.email', '==', email.toLowerCase()).get();
  return snap.docs
    .map((d) => ({ ref: d.id, booking: d.data() as Booking }))
    // Imported Acuity bookings are excluded on purpose. Offering a magic link for one
    // would open a manage page whose buttons all refuse -- and Acuity, not us, is
    // still the system that booking belongs to.
    .filter(({ booking }) => booking.source !== 'acuity')
    .filter(({ booking }) => booking.status === 'confirmed' && booking.end.toDate() > now);
}

export interface ApplyChangeInput {
  ref: string;
  start?: Date;
  end?: Date;
  pricePence?: number;
  status?: BookingStatus;
  calendarEventId?: string | null;
  /**
   * Appended to the ledger. A list because one refund can span several payments:
   * an amended-upwards booking holds its money in more than one charge.
   */
  payments?: Omit<Payment, 'at'>[];
  history: Omit<HistoryEntry, 'at'>;
}

/**
 * Applies an amendment or cancellation.
 *
 * `payments` is append-only and `paidPence` is recomputed from it in the same
 * write, so the ledger and the derived total can never disagree.
 */
export async function applyChange(input: ApplyChangeInput): Promise<Booking> {
  const database = await getDb();
  const docRef = database.collection('bookings').doc(input.ref);
  return database.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) throw new Error(`No booking ${input.ref}`);
    const b = snap.data() as Booking;
    const now = Timestamp.now();

    const payments = input.payments?.length
      ? [...b.payments, ...input.payments.map((entry) => ({ ...entry, at: now }))]
      : b.payments;
    const paidPence = payments.reduce((sum, p) => {
      if (p.status !== 'completed') return sum;
      return p.kind === 'charge' ? sum + p.amountPence : sum - p.amountPence;
    }, 0);

    const next: Partial<Booking> = {
      payments, paidPence, updatedAt: now,
      history: [...b.history, { ...input.history, at: now }],
      ...(input.start ? { start: Timestamp.fromDate(input.start), localDate: instantToLocalDate(input.start) } : {}),
      ...(input.end ? { end: Timestamp.fromDate(input.end) } : {}),
      ...(input.start && input.end
        ? { durationMins: Math.round((input.end.getTime() - input.start.getTime()) / MINUTE) } : {}),
      ...(input.pricePence !== undefined ? { pricePence: input.pricePence } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.calendarEventId !== undefined ? { calendarEventId: input.calendarEventId } : {}),
    };
    tx.update(docRef, next);
    return { ...b, ...next } as Booking;
  });
}

// --- Rate limiting -------------------------------------------------------

/**
 * A fixed-window counter in Firestore.
 *
 * Fixed rather than sliding because the failure mode of a fixed window -- up to
 * double the limit across a boundary -- is irrelevant here, and a sliding window
 * needs a document per event. This is for making abuse tedious, not for precision.
 *
 * The read and write are one transaction, so parallel requests cannot both see a
 * count under the limit and both proceed.
 */
export async function rateLimit(
  key: string, limit: number, windowMins: number, now = new Date(),
): Promise<{ allowed: boolean; remaining: number }> {
  const database = await getDb();
  const ref = database.collection('ratelimits').doc(encodeURIComponent(key));
  return database.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const windowMs = windowMins * MINUTE;
    const data = snap.exists ? snap.data() as { windowStart: Timestamp; count: number } : null;

    if (!data || now.getTime() - data.windowStart.toDate().getTime() > windowMs) {
      tx.set(ref, {
        windowStart: Timestamp.fromDate(now), count: 1,
        // TTL tidies these up; nothing reads them after the window.
        expiresAt: Timestamp.fromDate(new Date(now.getTime() + windowMs * 2)),
      });
      return { allowed: true, remaining: limit - 1 };
    }
    if (data.count >= limit) return { allowed: false, remaining: 0 };
    tx.update(ref, { count: data.count + 1 });
    return { allowed: true, remaining: limit - data.count - 1 };
  });
}

// --- Admin queries -------------------------------------------------------

/**
 * Every booking overlapping a window, soonest first.
 *
 * Reads and filters in memory rather than composing Firestore queries per filter.
 * At the DRA's volume -- a few thousand bookings a year -- that is correct, fast,
 * and avoids a composite index per filter combination the committee might want.
 */
export async function listBookings(
  from: Date, to: Date,
): Promise<{ ref: string; booking: Booking }[]> {
  const database = await getDb();
  const snap = await database.collection('bookings')
    .where('start', '>=', Timestamp.fromDate(from))
    .where('start', '<=', Timestamp.fromDate(to))
    .orderBy('start', 'asc')
    .get();
  return snap.docs.map((d) => ({ ref: d.id, booking: d.data() as Booking }));
}

/** Appends an internal note. Never visible to the booker. */
export async function addAdminNote(ref: string, note: string, actor: string): Promise<void> {
  await applyChange({ ref, history: { action: `note: ${note}`, actor: 'admin' } });
  const database = await getDb();
  await database.collection('bookings').doc(ref).update({ lastNoteBy: actor });
}
