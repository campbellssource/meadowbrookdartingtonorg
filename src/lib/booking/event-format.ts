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
//   utils/phoneExtractor.js   Phone:\s*(\+?\d{10,})    read for call screening
//   utils/nameExtractor.js    /^\s*Name:\s*(.+)$/mi
//   utils/titleExtractor.js   strips a trailing " (Calendar Name)" from the title
//   config/lockMappings.js    all three rooms are wired to locks
//
// Since 3 Sep 2026 the door code itself is allocated by this system
// (`door-code.ts`) rather than derived by the door system from the phone number,
// and it is written as its own line:
//
//   Pass Code: 48213          label, colon, one space, digits, nothing else
//
// The `Phone:` line is left exactly as it was -- the door system still reads it.
//
// Since 22 Nov 2026 the Pass Code line is kept well away from `Phone:` (a blank
// line, then below `Booking:`). Apple Calendar's data detector folds a number
// followed closely by a "pass code" into one dial string
// ("+447755555555;1234"), which makes the Call button useless. The door system
// matches `pass code:` anywhere in the description, so position is free; the
// value must stay bare digits, so it cannot be quoted or decorated.
// A code is 4 digits (from the phone) or 5 (generated), always a string, and a
// leading zero is part of it: "Pass Code: 0044", never "Pass Code: 44".
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
 * run at five digits and the door system cannot read the number. Every separator
 * has to go.
 */
export function normalisePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  return plus ? `+${digits}` : digits;
}

// --- The Pass Code line ------------------------------------------------------

export const PASS_CODE_LABEL = 'Pass Code';

/** `Pass Code: 48213`. The code is a string; this never formats a number. */
export const passCodeLine = (code: string): string => `${PASS_CODE_LABEL}: ${code}`;

// Anchored to a whole line and strict about the shape, so a mangled line
// ("Pass Code:48213", "Pass Code: 48213 (old)") reads as absent and gets rewritten
// rather than half-parsed. Tolerates a trailing \r in case a client saved CRLF.
const PASS_CODE_RE = /^Pass Code: (\d{4,9})\r?$/m;
const ANY_PASS_CODE_LINE = /^Pass Code:/;

/** The code an event description carries, or null if it has no well-formed line. */
export function readPassCode(description: string): string | null {
  return description.match(PASS_CODE_RE)?.[1] ?? null;
}

/**
 * Rewrites the `Pass Code:` line of an existing description and changes nothing
 * else -- the `Phone:` line in particular stays byte-for-byte as it was.
 *
 * Replaces the line in place if there is one and drops any duplicates. Otherwise
 * it inserts the line in its own block after `Booking:` (or at the end, if there
 * is no `Booking:`), never next to `Phone:` (see the header for why). Line endings are normalised to LF, which is what Google
 * returns.
 */
export function setPassCodeLine(description: string, code: string): string {
  const lines = description.split(/\r?\n/);
  const first = lines.findIndex((l) => ANY_PASS_CODE_LINE.test(l));
  if (first >= 0) {
    const kept = lines.filter((l, i) => i === first || !ANY_PASS_CODE_LINE.test(l));
    kept[first] = passCodeLine(code);
    return kept.join('\n');
  }
  // Straight after `Booking:` when there is one, so the code comes before the
  // free-text intake answers: the door system takes the FIRST `pass code:` it
  // finds, and an older or hand-edited answer may not have been sanitised.
  const booking = lines.findIndex((l) => /^Booking:/.test(l));
  if (booking >= 0) {
    const tail = lines.slice(booking + 1);
    const gap = tail.length && tail[0].trim() ? [''] : [];
    return [...lines.slice(0, booking + 1), '', passCodeLine(code), ...gap, ...tail].join('\n');
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return [...lines, '', passCodeLine(code)].join('\n');
}

/**
 * Makes a free-text field safe to put in a calendar event.
 *
 * The description is a parsing contract, not prose: the door system reads
 * `Phone:\s*(\+?\d{10,})` from it (unanchored and non-global, so the FIRST match
 * wins), `^\s*Name:\s*(.+)$` per line, and now the `Pass Code:` line. A booker
 * whose name contains "Pass Code: 1234" would otherwise plant a second line,
 * and which one the door system honours is not ours to decide.
 *
 * `[TEST EVENT]` is stripped for a different reason: it is the marker
 * `booking-test-events.ts` uses to decide what is safe to delete from the live
 * room calendars. A booking whose name contained it would be deleted as test data.
 *
 * Found by /security-review, 2 Sep 2026. Neither is a privilege escalation, but
 * both let user input impersonate machine-readable structure, which is worth
 * refusing on principle and costs one function.
 */
export function sanitiseForCalendar(value: string): string {
  // Repeated until nothing changes: one pass turns "[TEST[TEST EVENT] EVENT]"
  // into a live marker. No word boundary on the labels either -- the door
  // system's regexes are unanchored, so "backupPhone:" or "xPassCode:" match
  // there just as "Phone:" does. (Copilot review on #61, 22 Nov 2026.)
  let out = value;
  for (let prev = ''; prev !== out;) {
    prev = out;
    out = out
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\[TEST\s*EVENT\]/gi, '')
      .replace(/(Phone|Name|Email|Price|Booking|Calendar|Pass\s*Code)\s*:/gi, '$1 -')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return out;
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
  /**
   * The booking's allocated door code, as a string. Null writes no line at all,
   * which only a booking with no code should ever do.
   */
  passCode: string | null;
  /**
   * The booker's answers to the room's intake questions (`customer.notes`), one
   * `Question answer` line each. Empty or absent writes nothing.
   */
  notes?: string;
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
  return `${prefix}${sanitiseForCalendar(f.name)}: ${label}. ${durationLabel(mins)} (${calendar})`;
}

/**
 * Description. `Name:`, `Phone:` and `Pass Code:` must each be on their own
 * line — the name regex is anchored per-line with `^...$` under the `m` flag,
 * and the pass code line is defined as a whole line.
 *
 * The Pass Code sits in its own block, separated from `Phone:` by four lines and
 * a blank one, so Apple Calendar does not fold it into the phone number. The
 * intake answers come last: they are free text, and every machine-read line is
 * written before them so the door system's first-match regexes find ours first.
 */
export function buildDescription(f: BookingEventFields): string {
  const date = f.start.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric',
  });
  const lines = [
    `${date} ${instantToLocalTime(f.start)}`,
    `Calendar: ${CALENDAR_DISPLAY_NAME[f.room.slug] ?? f.room.shortName}`,
    `Name: ${sanitiseForCalendar(f.name)}`,
    `Phone: ${normalisePhone(f.phone)}`,
    `Email: ${sanitiseForCalendar(f.email)}`,
    `Price: £${(f.pricePence / 100).toFixed(2)}`,
    `Booking: ${f.reference}`,
  ];
  if (f.passCode) lines.push('', passCodeLine(f.passCode));
  const answers = (f.notes ?? '').split(/\r?\n/).map(sanitiseForCalendar).filter(Boolean);
  if (answers.length) lines.push('', ...answers);
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
