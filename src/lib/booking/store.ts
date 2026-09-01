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

  // The Workspace blocks service-account keys, so local dev impersonates through
  // your own ADC. On Cloud Run this is unset and the runtime SA is used directly.
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
): Promise<Interval[]> {
  const database = await getDb();
  const [bookingSnap, holdSnap] = await Promise.all([
    tx.get(database.collection('bookings').where('room', '==', room).where('localDate', '==', localDate)),
    tx.get(database.collection('holds').where('room', '==', room).where('localDate', '==', localDate)),
  ]);

  const out: Interval[] = [];
  for (const doc of bookingSnap.docs) {
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
    const promised = await promisedIntervals(tx, room.slug, localDate, now);
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
}

/** Turns a paid hold into a booking, and releases the hold, in one write. */
export async function confirmBooking(input: ConfirmInput): Promise<Booking> {
  const database = await getDb();
  const now = Timestamp.now();
  const booking: Booking = {
    room: input.room.slug,
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
