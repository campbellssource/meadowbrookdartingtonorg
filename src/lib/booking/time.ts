// Time handling for the booking system.
//
// Everything the DRA thinks in is Europe/London wall-clock: "the Studio, Tuesday
// at 7pm". Everything Google Calendar and Firestore think in is an absolute
// instant. This module is the only place those two meet, so the conversion is
// written once, tested once, and cannot drift.
//
// No date library. `Intl` already knows the London DST rules and ships with Node,
// and a dependency that has to be kept current for a village hall booking form is
// a liability rather than an asset.

/** A London wall-clock date, `YYYY-MM-DD`. Never carries a time or a zone. */
export type LocalDate = string;
/** A London wall-clock time of day, `HH:MM`, 24-hour. */
export type LocalTime = string;

export const LONDON = 'Europe/London';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

interface Parts { year: number; month: number; day: number; hour: number; minute: number; second: number }

function londonParts(instant: Date): Parts {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(instant)) p[type] = value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    // en-GB with hour12:false renders midnight as "24" rather than "00".
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
  };
}

/**
 * Milliseconds London is ahead of UTC at a given instant: 0 in GMT, 3600000 in BST.
 * Derived by asking Intl what the wall clock reads and comparing, so the DST rules
 * come from the platform's tz database rather than from us guessing.
 */
export function londonOffsetMs(instant: Date): number {
  const p = londonParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Second-truncated on both sides, so no sub-second drift creeps in.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * London wall-clock -> absolute instant.
 *
 * Two passes, and the second one matters. The offset depends on the instant, but
 * the instant is what we are trying to find. Guessing with the offset at the naive
 * reading and then re-checking converges everywhere except inside a DST
 * transition, which the callers below never enter: the rooms open at 08:00 and the
 * UK transitions happen at 01:00 and 02:00.
 */
export function londonToInstant(date: LocalDate, time: LocalTime): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const firstGuess = new Date(naive - londonOffsetMs(new Date(naive)));
  const corrected = new Date(naive - londonOffsetMs(firstGuess));
  return corrected;
}

/** Absolute instant -> the London date it falls on. */
export function instantToLocalDate(instant: Date): LocalDate {
  const p = londonParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Absolute instant -> London wall-clock `HH:MM`. */
export function instantToLocalTime(instant: Date): LocalTime {
  const p = londonParts(instant);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * An ISO 8601 string carrying London's *actual* offset, e.g.
 * `2026-09-05T09:00:00+01:00`. Clients get an unambiguous instant they can render
 * in the viewer's own zone without us having shipped "+01:00" as a hardcoded lie
 * that breaks every October.
 */
export function toLondonISO(instant: Date): string {
  const p = londonParts(instant);
  const offMin = londonOffsetMs(instant) / 60000;
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export const MINUTE = 60_000;

export const addMinutes = (instant: Date, mins: number): Date =>
  new Date(instant.getTime() + mins * MINUTE);

/** Minutes from midnight for an `HH:MM`. 08:00 -> 480. */
export function minutesOfDay(time: LocalTime): number {
  const [hh, mm] = time.split(':').map(Number);
  return hh * 60 + mm;
}

/**
 * The first quarter-hour boundary strictly after `now`.
 *
 * Strictly, deliberately: at 14:00:00 exactly this returns 14:15, not 14:00. The
 * DRA's rule is that you cannot book the quarter-hour you are standing in, and
 * defining the edge this way costs at most fifteen minutes while removing a whole
 * class of clock-skew bug. The browser, this server and Google disagree by seconds;
 * "at or after" would turn those seconds into a slot that renders as bookable and
 * then fails at payment.
 */
export function nextQuarterHour(now: Date, granularityMins = 15): Date {
  const ms = granularityMins * MINUTE;
  return new Date((Math.floor(now.getTime() / ms) + 1) * ms);
}

/** Every `stepMins` boundary from `from` up to and including `to`. */
export function* walk(from: Date, to: Date, stepMins: number): Generator<Date> {
  for (let t = from.getTime(); t <= to.getTime(); t += stepMins * MINUTE) yield new Date(t);
}

/** A half-open interval `[start, end)`. Touching intervals do not overlap. */
export interface Interval { start: Date; end: Date }

export const overlaps = (a: Interval, b: Interval): boolean =>
  a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();

/** Sorts by start, then merges anything touching or overlapping. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [{ ...sorted[0] }];
  for (const cur of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (cur.start.getTime() <= last.end.getTime()) {
      if (cur.end.getTime() > last.end.getTime()) last.end = cur.end;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}
