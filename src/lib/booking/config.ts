// Room booking configuration.
//
// The rules live in Keystatic alongside the rest of the facility content, so the
// committee can change a price or an opening hour without a developer. Only the
// calendar ID is overridable from the environment, and only so that local
// development can point at throwaway calendars instead of the live rooms.
//
// Deliberately free of I/O and of any Keystatic import: reading the CMS lives in
// `config-reader.ts`. That keeps the rules -- which the tests care about -- loadable
// without pulling in the CMS, its dependency tree, and a working content directory.

import type { LocalTime } from './time.ts';
import { env } from './env.ts';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface OpeningHours { day: Weekday; from: LocalTime; to: LocalTime }

export interface PeakRule { days: Weekday[]; from: LocalTime; to: LocalTime; hourlyRatePence: number }

export interface IntakeQuestion { key: string; label: string; required: boolean }

export interface RoomBookingConfig {
  /** Facility slug, e.g. `large-room`. Identifies the room everywhere else. */
  slug: string;
  /** Short human name used in calendar summaries and emails, e.g. "Studio". */
  shortName: string;
  calendarId: string;
  hourlyRatePence: number;
  /** Ordered; first match wins. Empty for all three rooms today — no peak rate. */
  peak: PeakRule[];
  openingHours: OpeningHours[];
  /** Grid the start times sit on. 15 everywhere: :00, :15, :30, :45. */
  slotGranularityMins: number;
  minDurationMins: number;
  /** Steps above the minimum. 30 everywhere: 1h, 1h30, 2h... */
  durationIncrementMins: number;
  /** Ceiling only; the real cap is closing time on the day the booking starts. */
  maxDurationMins: number;
  /** Forced gap before and after every booking. 0 snooker, 30 studio/lounge. */
  bufferMins: number;
  /** 0 everywhere. The quarter-hour rule in `time.ts` is the real floor. */
  minNoticeHours: number;
  maxAdvanceDays: number;
  capacityNote: string;
  intakeQuestions: IntakeQuestion[];
  active: boolean;
}

/**
 * Applied to anything Keystatic leaves unset. These are the DRA's confirmed rules
 * (31 Aug 2026), so a room that specifies nothing but a calendar and a rate still
 * behaves correctly.
 */
export const DEFAULTS = {
  peak: [] as PeakRule[],
  openingHours: WEEKDAYS.map((day) => ({ day, from: '08:00', to: '23:00' })) as OpeningHours[],
  slotGranularityMins: 15,
  minDurationMins: 60,
  durationIncrementMins: 30,
  maxDurationMins: 900, // 08:00-23:00
  bufferMins: 0,
  minNoticeHours: 0,
  maxAdvanceDays: 90,
  capacityNote: '',
  intakeQuestions: [] as IntakeQuestion[],
  active: true,
} as const;

/**
 * The live room calendars. Named here for one reason: to refuse to start in
 * development if a calendar override still points at one of them.
 */
export const PRODUCTION_CALENDAR_IDS: readonly string[] = [
  'c_7d03780450348bae6a9fbe620e8d8d70254f5da1f058ca9a631e89a820850c71@group.calendar.google.com', // Snooker room
  'c_c5f1e9f56d6290965b22e21e136bff0cc2bfefba5fd641b9902efe67a31b5cc7@group.calendar.google.com', // Studio - Large room
  'c_33f4213aac4c1fe8fb9a7a79b063d038b983bc79549f43fdb6bc93847c302977@group.calendar.google.com', // Lounge - Small room
];

const envKey = (slug: string): string =>
  `BOOKING_CALENDAR_${slug.toUpperCase().replace(/-/g, '_')}`;

/**
 * Calendar ID for a room: the environment wins, so local development can be
 * pointed at throwaway calendars without touching content.
 */
export function resolveCalendarId(slug: string, configured: string): string {
  return env(envKey(slug)) ?? configured;
}

/**
 * True when a non-production environment has resolved a live room calendar.
 *
 * Reading a live calendar from a laptop is fine and useful -- it is how Phase 1's
 * output gets compared against Acuity. *Writing* to one is not: a calendar
 * override is one typo away from putting test bookings on the real Studio, and
 * because the calendar is the source of truth for occupancy (D1), those junk
 * events would block real hirers.
 *
 * So this flags rather than throws, and `assertWritable` does the refusing at the
 * point where it matters. Reads stay open; writes are the thing worth guarding.
 */
export function isProductionCalendar(calendarId: string): boolean {
  return PRODUCTION_CALENDAR_IDS.includes(calendarId);
}

/**
 * Call before any calendar write. Throws if this environment would be writing to
 * a live room calendar without being production.
 */
export function assertWritable(room: Pick<RoomBookingConfig, 'slug' | 'calendarId'>): void {
  if (process.env.NODE_ENV === 'production') return;
  if (!isProductionCalendar(room.calendarId)) return;
  throw new Error(
    `Refusing to write: room "${room.slug}" resolves to the LIVE calendar while NODE_ENV is `
    + `"${process.env.NODE_ENV ?? 'undefined'}". Set ${envKey(room.slug)} to a dev calendar `
    + `(see spec/booking/11-local-development.md), or set NODE_ENV=production if this really `
    + `is production.`,
  );
}

/** Shape of the `booking` block as Keystatic stores it. All fields optional. */
export interface StoredBooking {
  calendarId?: string | null;
  shortName?: string | null;
  hourlyRatePence?: number | null;
  openingFrom?: string | null;
  openingTo?: string | null;
  slotGranularityMins?: number | null;
  minDurationMins?: number | null;
  durationIncrementMins?: number | null;
  maxDurationMins?: number | null;
  bufferMins?: number | null;
  minNoticeHours?: number | null;
  maxAdvanceDays?: number | null;
  capacityNote?: string | null;
  intakeQuestions?: readonly { key?: string | null; label?: string | null; required?: boolean | null }[] | null;
  active?: boolean | null;
}

/** Turns a stored block into a full config, applying defaults and the env override. */
export function toRoomConfig(slug: string, stored: StoredBooking): RoomBookingConfig | null {
  if (!stored?.calendarId) return null;

  const from = stored.openingFrom || '08:00';
  const to = stored.openingTo || '23:00';
  const calendarId = resolveCalendarId(slug, stored.calendarId);

  return {
    slug,
    shortName: stored.shortName || slug,
    calendarId,
    hourlyRatePence: stored.hourlyRatePence ?? 0,
    peak: DEFAULTS.peak,
    openingHours: WEEKDAYS.map((day) => ({ day, from, to })),
    slotGranularityMins: stored.slotGranularityMins ?? DEFAULTS.slotGranularityMins,
    minDurationMins: stored.minDurationMins ?? DEFAULTS.minDurationMins,
    durationIncrementMins: stored.durationIncrementMins ?? DEFAULTS.durationIncrementMins,
    maxDurationMins: stored.maxDurationMins ?? DEFAULTS.maxDurationMins,
    bufferMins: stored.bufferMins ?? DEFAULTS.bufferMins,
    minNoticeHours: stored.minNoticeHours ?? DEFAULTS.minNoticeHours,
    maxAdvanceDays: stored.maxAdvanceDays ?? DEFAULTS.maxAdvanceDays,
    capacityNote: stored.capacityNote || '',
    intakeQuestions: (stored.intakeQuestions ?? [])
      .filter((q): q is { key: string; label: string; required?: boolean | null } => Boolean(q?.key && q?.label))
      .map((q) => ({ key: q.key, label: q.label, required: q.required ?? false })),
    active: stored.active ?? DEFAULTS.active,
  };
}
