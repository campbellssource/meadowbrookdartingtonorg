// Income analysis. Pure: bookings in, numbers out.
//
// Everything is computed by reading the period's bookings and folding them in
// memory. No pre-aggregation, no counters, no scheduled rollups -- at a few
// thousand bookings a year those would be three more things to keep in sync for a
// dataset that fits comfortably in one request.

import type { Booking } from './store.ts';
import { MINUTE } from './time.ts';

export interface Row { ref: string; booking: Booking }

export interface Headline {
  grossPence: number;
  refundedPence: number;
  netPence: number;
  bookingCount: number;
  cancelledCount: number;
  cancellationRate: number;
  averageValuePence: number;
  averageDurationMins: number;
  /** Money Square has taken or returned but not settled. Pending until the webhook. */
  unsettledPence: number;
}

const completed = (b: Booking, kind: 'charge' | 'refund') =>
  b.payments.filter((p) => p.kind === kind && p.status === 'completed')
    .reduce((s, p) => s + p.amountPence, 0);

const pending = (b: Booking) =>
  b.payments.filter((p) => p.status === 'pending')
    .reduce((s, p) => s + p.amountPence, 0);

export function headline(rows: Row[]): Headline {
  const live = rows.filter(({ booking }) => booking.status !== 'orphaned');
  const gross = live.reduce((s, { booking }) => s + completed(booking, 'charge'), 0);
  const refunded = live.reduce((s, { booking }) => s + completed(booking, 'refund'), 0);
  const cancelled = live.filter(({ booking }) => booking.status === 'cancelled').length;
  const durations = live.reduce((s, { booking }) => s + booking.durationMins, 0);
  return {
    grossPence: gross,
    refundedPence: refunded,
    netPence: gross - refunded,
    bookingCount: live.length,
    cancelledCount: cancelled,
    cancellationRate: live.length ? cancelled / live.length : 0,
    averageValuePence: live.length ? Math.round((gross - refunded) / live.length) : 0,
    averageDurationMins: live.length ? Math.round(durations / live.length) : 0,
    unsettledPence: live.reduce((s, { booking }) => s + pending(booking), 0),
  };
}

/** Net revenue by room by month, as `{ month, room, netPence }`. */
export function byRoomByMonth(rows: Row[]): { month: string; room: string; netPence: number }[] {
  const acc = new Map<string, number>();
  for (const { booking } of rows) {
    if (booking.status === 'orphaned') continue;
    const month = booking.localDate.slice(0, 7);
    const key = `${month}|${booking.room}`;
    acc.set(key, (acc.get(key) ?? 0) + completed(booking, 'charge') - completed(booking, 'refund'));
  }
  return [...acc.entries()]
    .map(([key, netPence]) => {
      const [month, room] = key.split('|');
      return { month, room, netPence };
    })
    .sort((a, b) => a.month.localeCompare(b.month) || a.room.localeCompare(b.room));
}

/**
 * Booked hours as a share of opening hours, by room by month.
 *
 * The number Acuity does not give the DRA, and the one that answers "should we
 * raise this price or market this room".
 */
export function occupancy(
  rows: Row[], openingHoursPerDay: number,
): { month: string; room: string; bookedHours: number; availableHours: number; rate: number }[] {
  const acc = new Map<string, number>();
  for (const { booking } of rows) {
    if (booking.status !== 'confirmed') continue;
    const key = `${booking.localDate.slice(0, 7)}|${booking.room}`;
    acc.set(key, (acc.get(key) ?? 0) + booking.durationMins / 60);
  }
  return [...acc.entries()].map(([key, bookedHours]) => {
    const [month, room] = key.split('|');
    const [y, m] = month.split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const availableHours = days * openingHoursPerDay;
    return { month, room, bookedHours, availableHours, rate: bookedHours / availableHours };
  }).sort((a, b) => a.month.localeCompare(b.month) || a.room.localeCompare(b.room));
}

/** Demand by weekday and hour, per room. */
export function demandGrid(rows: Row[], room?: string): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const { booking } of rows) {
    if (booking.status !== 'confirmed') continue;
    if (room && booking.room !== room) continue;
    const start = booking.start.toDate();
    const day = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' })
      .format(start).replace(/(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/, (m) =>
        String(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(m))));
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', hour12: false,
    }).format(start)) % 24;
    if (Number.isInteger(day) && day >= 0 && day < 7) grid[day][hour] += 1;
  }
  return grid;
}

/** How far ahead people book, bucketed. */
export function leadTimes(rows: Row[]): { bucket: string; count: number }[] {
  const buckets = [
    { bucket: 'Same day', max: 1 }, { bucket: '1–2 days', max: 3 },
    { bucket: '3–7 days', max: 8 }, { bucket: '1–4 weeks', max: 29 },
    { bucket: 'Over a month', max: Infinity },
  ];
  const counts = new Map(buckets.map((b) => [b.bucket, 0]));
  for (const { booking } of rows) {
    if (booking.status === 'orphaned') continue;
    const days = (booking.start.toDate().getTime() - booking.createdAt.toDate().getTime()) / (24 * 60 * MINUTE);
    const hit = buckets.find((b) => days < b.max)!;
    counts.set(hit.bucket, (counts.get(hit.bucket) ?? 0) + 1);
  }
  return buckets.map((b) => ({ bucket: b.bucket, count: counts.get(b.bucket) ?? 0 }));
}

/**
 * Repeat bookers and their share of revenue.
 *
 * Exists to put a number against the recurring-bookings feature deferred in `00`:
 * if repeat hirers are most of the income, that decision changes.
 */
export function repeatBookers(rows: Row[]): {
  uniqueBookers: number; repeatBookers: number; repeatRevenueShare: number;
} {
  const byEmail = new Map<string, number>();
  let total = 0;
  for (const { booking } of rows) {
    if (booking.status === 'orphaned') continue;
    const net = completed(booking, 'charge') - completed(booking, 'refund');
    const email = booking.customer.email.toLowerCase();
    byEmail.set(email, (byEmail.get(email) ?? 0) + net);
    total += net;
  }
  const counts = new Map<string, number>();
  for (const { booking } of rows) {
    if (booking.status === 'orphaned') continue;
    const email = booking.customer.email.toLowerCase();
    counts.set(email, (counts.get(email) ?? 0) + 1);
  }
  const repeats = [...counts.entries()].filter(([, n]) => n > 1).map(([e]) => e);
  const repeatRevenue = repeats.reduce((s, e) => s + (byEmail.get(e) ?? 0), 0);
  return {
    uniqueBookers: byEmail.size,
    repeatBookers: repeats.length,
    repeatRevenueShare: total ? repeatRevenue / total : 0,
  };
}
