// How a booking is written onto a room calendar.
//
// This is an integration contract, not a formatting preference. A separate live
// system (`calendartopasscode`, see spec/booking/13) watches these calendars and
// provisions the building's door codes from what it reads here. Get the shape
// wrong and the booking still succeeds, the payment still clears, the
// confirmation email still sends -- and the hirer stands outside a locked door.
//
// The rules below were read out of that system's source on 31 Aug 2026, not
// inferred from example events:
//
//   utils/phoneExtractor.js   Phone:\s*(\+?\d{10,})    passcode = LAST 4 DIGITS
//   utils/nameExtractor.js    /^\s*Name:\s*(.+)$/mi
//   utils/titleExtractor.js   strips a trailing " (Calendar Name)" from the title
//   config/lockMappings.js    all three rooms are wired to locks
//
// If any of those change, `test/booking-event-format.test.ts` fails, because it
// asserts against copies of those exact regexes.

import { TEST_EVENT_MARKER } from './calendar.ts';
import type { RoomBookingConfig } from './config.ts';
import { instantToLocalTime, MINUTE } from './time.ts';

/** The calendar's own name, appended in parentheses and stripped by the parser. */
export const CALENDAR_DISPLAY_NAME: Record<string, string> = {
  'snooker-room': 'Snooker room',
  'large-room': 'Studio - Large room',
  'small-room': 'Lounge - Small room',
};

/** Room label used in the middle of the title, matching Acuity's wording. */
const ROOM_LABEL: Record<string, string> = {
  'snooker-room': 'Snooker room',
  'large-room': 'Large room',
  'small-room': 'Small Room',
};

/** "1h", "1h 30mins", "4h" — the duration wording Acuity used. */
export function durationLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}mins`;
  if (h) return `${h}h`;
  return `${m}mins`;
}

/**
 * Phone number as the parser requires: optional `+`, then **contiguous** digits.
 *
 * The regex is `\d{10,}`, so "07725 972868" does not match — the space breaks the
 * run at five digits and the whole booking silently gets no door code. Every
 * separator has to go.
 */
export function normalisePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  return plus ? `+${digits}` : digits;
}

/** The door code this booking will actually get: the last four digits. */
export function doorCodeFor(phone: string): string | null {
  const digits = normalisePhone(phone).replace(/[^\d]/g, '');
  return digits.length >= 10 ? digits.slice(-4) : null;
}

export interface BookingEventFields {
  room: RoomBookingConfig;
  name: string;
  phone: string;
  email: string;
  start: Date;
  end: Date;
  pricePence: number;
  reference: string;
  /** Marks the event as ours to delete. Always true outside production. */
  isTest?: boolean;
}

/**
 * Title: `<Name>: <Room>. <duration> (<Calendar name>)`.
 *
 * The parenthetical is stripped by `extractTitleForPasscode` and the remainder
 * becomes the passcode's label on the lock, so it is what a volunteer sees in the
 * TTLock app.
 */
export function buildSummary(f: BookingEventFields): string {
  const mins = Math.round((f.end.getTime() - f.start.getTime()) / MINUTE);
  const label = ROOM_LABEL[f.room.slug] ?? f.room.shortName;
  const calendar = CALENDAR_DISPLAY_NAME[f.room.slug] ?? f.room.shortName;
  const prefix = f.isTest ? `${TEST_EVENT_MARKER} ` : '';
  return `${prefix}${f.name}: ${label}. ${durationLabel(mins)} (${calendar})`;
}

/**
 * Description. `Name:` and `Phone:` must each be on their own line — the name
 * regex is anchored per-line with `^...$` under the `m` flag.
 */
export function buildDescription(f: BookingEventFields): string {
  const date = f.start.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric',
  });
  const lines = [
    `${date} ${instantToLocalTime(f.start)}`,
    `Calendar: ${CALENDAR_DISPLAY_NAME[f.room.slug] ?? f.room.shortName}`,
    `Name: ${f.name}`,
    `Phone: ${normalisePhone(f.phone)}`,
    `Email: ${f.email}`,
    `Price: £${(f.pricePence / 100).toFixed(2)}`,
    `Booking: ${f.reference}`,
  ];
  if (f.isTest) {
    lines.unshift(TEST_EVENT_MARKER, 'Automated test booking. Safe to delete.');
  }
  return lines.join('\n');
}

export function buildEvent(f: BookingEventFields) {
  return {
    summary: buildSummary(f),
    description: buildDescription(f),
    start: f.start,
    end: f.end,
  };
}
