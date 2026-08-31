// The availability engine.
//
// Pure: busy blocks and the current time are passed in, never fetched. That is
// what makes the rules -- the riskiest part of the system -- testable at a
// thousand cases a second with no network, no calendar and no database.
//
// Fetching lives in `calendar.ts`; composing the two lives in the API route.

import type { RoomBookingConfig, Weekday } from './config.ts';
import { WEEKDAYS } from './config.ts';
import { durationsFor, priceFor } from './pricing.ts';
import {
  londonToInstant, toLondonISO, minutesOfDay, addMinutes, mergeIntervals,
  nextQuarterHour, MINUTE,
} from './time.ts';
import type { Interval, LocalDate } from './time.ts';

export interface SlotOption { mins: number; pricePence: number }

export interface Slot {
  /** ISO 8601 with London's real offset, e.g. `2026-09-05T09:00:00+01:00`. */
  start: string;
  /** Longest bookable run from this start, after buffers and closing time. */
  maxDurationMins: number;
  durations: SlotOption[];
}

export interface DayAvailability {
  date: LocalDate;
  open: boolean;
  slots: Slot[];
}

export interface AvailabilityResult {
  room: string;
  timeZone: 'Europe/London';
  days: DayAvailability[];
}

export interface ComputeInput {
  room: RoomBookingConfig;
  /** Inclusive range of London dates. */
  from: LocalDate;
  to: LocalDate;
  /** Everything occupying the room: calendar events and live holds, unmerged. */
  busy: Interval[];
  now: Date;
}

/**
 * Widens every busy block by the room's buffer on both sides, then merges.
 *
 * Buffering the *existing* bookings rather than the candidate is what gives the
 * right answer at the edges of the day for free: an 08:00 start has nothing before
 * it to be separated from, so nothing pushes it out. A Studio booking of
 * 14:00-15:00 becomes 13:30-15:30, which is why the next bookable start is 15:30
 * and not 15:15.
 */
export function inflate(busy: Interval[], bufferMins: number): Interval[] {
  const widened = busy.map(({ start, end }) => ({
    start: addMinutes(start, -bufferMins),
    end: addMinutes(end, bufferMins),
  }));
  return mergeIntervals(widened);
}

const weekdayOf = (date: LocalDate): Weekday => {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

/** Every London date from `from` to `to` inclusive. */
export function datesBetween(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  // Walked in UTC on purpose: this is calendar-date arithmetic, and doing it on
  // instants would lose or repeat a day across a DST boundary.
  let cur = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  while (cur <= end) {
    const dt = new Date(cur);
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`);
    cur += 86_400_000;
  }
  return out;
}

/** How long the room is free from `start`, in minutes, before the next busy block. */
function freeRunMins(start: Date, closeAt: Date, blocked: Interval[]): number {
  if (start.getTime() >= closeAt.getTime()) return 0;
  let limit = closeAt.getTime();
  for (const b of blocked) {
    if (b.start.getTime() >= start.getTime() && b.start.getTime() < limit) limit = b.start.getTime();
    // Start sits inside a busy block: nothing is bookable here at all.
    if (b.start.getTime() <= start.getTime() && b.end.getTime() > start.getTime()) return 0;
  }
  return Math.floor((limit - start.getTime()) / MINUTE);
}

export function computeAvailability(input: ComputeInput): AvailabilityResult {
  const { room, from, to, busy, now } = input;
  const blocked = inflate(busy, room.bufferMins);

  // The floor on start times: the next quarter-hour boundary strictly after now,
  // pushed out by minNoticeHours if the room ever sets one (all are 0 today).
  const earliestStart = new Date(Math.max(
    nextQuarterHour(now, room.slotGranularityMins).getTime(),
    now.getTime() + room.minNoticeHours * 60 * MINUTE,
  ));
  const latestStart = addMinutes(now, room.maxAdvanceDays * 24 * 60);

  const days: DayAvailability[] = datesBetween(from, to).map((date) => {
    const hours = room.openingHours.find((h) => h.day === weekdayOf(date));
    if (!hours) return { date, open: false, slots: [] };

    const openAt = londonToInstant(date, hours.from);
    const closeAt = londonToInstant(date, hours.to);
    const slots: Slot[] = [];

    for (let m = minutesOfDay(hours.from); m <= minutesOfDay(hours.to); m += room.slotGranularityMins) {
      const start = addMinutes(openAt, m - minutesOfDay(hours.from));
      if (start.getTime() < earliestStart.getTime()) continue;
      if (start.getTime() > latestStart.getTime()) continue;

      // A booking must finish by closing time on the day it starts, so the run is
      // capped at close rather than allowed to spill into tomorrow.
      const runMins = Math.min(freeRunMins(start, closeAt, blocked), room.maxDurationMins);
      const durations = durationsFor(room, runMins);
      if (durations.length === 0) continue;

      slots.push({
        start: toLondonISO(start),
        maxDurationMins: durations[durations.length - 1],
        durations: durations.map((mins) => ({
          mins,
          pricePence: priceFor(room, start, addMinutes(start, mins)),
        })),
      });
    }

    return { date, open: true, slots };
  });

  return { room: room.slug, timeZone: 'Europe/London', days };
}

/** Is one specific booking allowed? The authority for the write path in Phase 2. */
export function isBookable(
  room: RoomBookingConfig, start: Date, end: Date, busy: Interval[], now: Date,
): { ok: true } | { ok: false; reason: string } {
  const mins = Math.round((end.getTime() - start.getTime()) / MINUTE);
  const earliest = new Date(Math.max(
    nextQuarterHour(now, room.slotGranularityMins).getTime(),
    now.getTime() + room.minNoticeHours * 60 * MINUTE,
  ));

  if (start.getTime() < earliest.getTime()) return { ok: false, reason: 'too-soon' };
  if (start.getTime() > addMinutes(now, room.maxAdvanceDays * 24 * 60).getTime()) {
    return { ok: false, reason: 'too-far-ahead' };
  }
  if (start.getTime() % (room.slotGranularityMins * MINUTE) !== 0) {
    return { ok: false, reason: 'not-on-grid' };
  }
  if (mins < room.minDurationMins) return { ok: false, reason: 'too-short' };
  if (mins > room.maxDurationMins) return { ok: false, reason: 'too-long' };
  if ((mins - room.minDurationMins) % room.durationIncrementMins !== 0) {
    return { ok: false, reason: 'bad-duration' };
  }

  const date = toLondonISO(start).slice(0, 10);
  const hours = room.openingHours.find((h) => h.day === weekdayOf(date));
  if (!hours) return { ok: false, reason: 'closed' };
  if (start.getTime() < londonToInstant(date, hours.from).getTime()) return { ok: false, reason: 'before-opening' };
  if (end.getTime() > londonToInstant(date, hours.to).getTime()) return { ok: false, reason: 'after-closing' };

  for (const b of inflate(busy, room.bufferMins)) {
    if (start.getTime() < b.end.getTime() && b.start.getTime() < end.getTime()) {
      return { ok: false, reason: 'occupied' };
    }
  }
  return { ok: true };
}
