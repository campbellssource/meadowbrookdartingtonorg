// Pricing. Pure, no I/O, no clock of its own.
//
// The single place a price is computed. Everything downstream -- the booking form,
// the confirmation email, refunds on amendment, the treasurer's report -- calls
// this, so a price can never be right in one place and wrong in another.
//
// It is also where VAT would go if the DRA ever registers (question 14). Today's
// prices are VAT-free rather than VAT-inclusive; see spec/booking/02.

import type { RoomBookingConfig, Weekday } from './config.ts';
import { WEEKDAYS, } from './config.ts';
import { instantToLocalTime, minutesOfDay, addMinutes, MINUTE } from './time.ts';

/** Billing granularity. Bookings are charged in half hours. */
export const BILLING_INCREMENT_MINS = 30;

// Constructed once. Building an Intl.DateTimeFormat is expensive, and pricing a
// day of availability calls this thousands of times.
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' });

function weekdayOf(instant: Date): Weekday {
  // getUTCDay is wrong near midnight in BST, so ask for the London day directly.
  const name = weekdayFmt.format(instant).toLowerCase().slice(0, 3);
  return (WEEKDAYS.includes(name as Weekday) ? name : 'mon') as Weekday;
}

/**
 * The hourly rate applying at a given instant: the first matching peak rule, else
 * the base rate. Peak is empty for all three rooms today, so this always returns
 * the base rate -- but a Saturday-evening rate later is a content change, not a
 * code change.
 */
export function rateAt(room: RoomBookingConfig, instant: Date): number {
  // No peak rules means the rate cannot vary, so none of the date arithmetic below
  // can change the answer. All three rooms are flat-rate today, and pricing a day
  // of availability asks this about ten thousand times.
  if (room.peak.length === 0) return room.hourlyRatePence;

  const day = weekdayOf(instant);
  const mins = minutesOfDay(instantToLocalTime(instant));
  for (const rule of room.peak) {
    if (!rule.days.includes(day)) continue;
    if (mins >= minutesOfDay(rule.from) && mins < minutesOfDay(rule.to)) return rule.hourlyRatePence;
  }
  return room.hourlyRatePence;
}

/**
 * Price for `[start, end)` in whole pence.
 *
 * Charged per half-hour increment at the rate applying when that increment
 * *starts*, so a booking straddling a peak boundary is priced per increment rather
 * than wholly at one rate or the other. With no peak rules configured this is
 * simply the hourly rate pro-rata.
 */
export function priceFor(room: RoomBookingConfig, start: Date, end: Date): number {
  const totalMins = Math.round((end.getTime() - start.getTime()) / MINUTE);
  if (totalMins <= 0) return 0;

  let pence = 0;
  for (let offset = 0; offset < totalMins; offset += BILLING_INCREMENT_MINS) {
    const chunk = Math.min(BILLING_INCREMENT_MINS, totalMins - offset);
    const rate = rateAt(room, addMinutes(start, offset));
    // Round each increment rather than the total: half an hour of a £7.50 rate is
    // exactly 375p, and rounding per increment keeps every displayed sub-total
    // consistent with the sum the booker is charged.
    pence += Math.round((rate * chunk) / 60);
  }
  return pence;
}

/** `true` if a duration is one the room actually offers. */
export function isValidDuration(room: RoomBookingConfig, mins: number): boolean {
  if (mins < room.minDurationMins) return false;
  if (mins > room.maxDurationMins) return false;
  return (mins - room.minDurationMins) % room.durationIncrementMins === 0;
}

/**
 * Every duration bookable from a start with `availableMins` of clear time ahead:
 * the minimum, then rising in increments, capped by the room maximum and by how
 * much room is actually free.
 */
export function durationsFor(room: RoomBookingConfig, availableMins: number): number[] {
  const out: number[] = [];
  const ceiling = Math.min(availableMins, room.maxDurationMins);
  for (let d = room.minDurationMins; d <= ceiling; d += room.durationIncrementMins) out.push(d);
  return out;
}

/** `£7.50`, `£15.00` -- for emails, receipts and the booking form. */
export const formatPence = (pence: number): string =>
  `£${(pence / 100).toFixed(2)}`;
