// Door codes: allocated here, written onto the calendar event, provisioned by the
// door system.
//
// Until September 2026 the door system (`calendartopasscode`, spec/booking/13)
// derived every code itself: the last four digits of the `Phone:` line. That
// failed in three ways the booking system could see and the door system could
// not: TTLock rejects "too simple" codes (error -2032), refuses a code value that
// already exists on a lock even for a booking at a different time (-3007), and a
// phone fragment can equal a permanent staff code. So allocation moved here, and
// the door system reads the result from a `Pass Code:` line instead.
//
// Two rules shape everything below:
//
//   - A code is a STRING. "0044" is a code, "44" is not the same code, and a
//     number type would lose the leading zero somewhere between Firestore, a
//     template and the calendar. Nothing in this file produces or accepts a number.
//   - Phone-derived codes are four digits; generated codes are five. A generated
//     code can therefore never equal a phone-derived one, and a five-digit code is
//     visibly "a door code" rather than a fragment of somebody's number.

import { randomInt } from 'node:crypto';
import { normalisePhone } from './event-format.ts';

export type DoorCodeSource = 'phone' | 'generated';

export interface AllocatedDoorCode {
  /** Digits only, 4 to 9 of them, leading zeros significant. */
  code: string;
  source: DoorCodeSource;
}

/** TTLock accepts 4-9 digits. */
export const MIN_DOOR_CODE_LENGTH = 4;
export const MAX_DOOR_CODE_LENGTH = 9;
/** Generated codes are one digit longer than a phone fragment, on purpose. */
export const GENERATED_DOOR_CODE_LENGTH = 5;

/**
 * How long after a booking ends its code stays reserved.
 *
 * The door system removes finished bookings' codes on an hourly sweep, and TTLock
 * refuses to add a value that is still present on the lock (-3007). A day is a
 * wide margin over an hour; the cost of being generous is one code value out of
 * ninety thousand being unavailable for a day.
 */
export const DOOR_CODE_RELEASE_HOURS = 24;

export const doorCodeReleaseAt = (end: Date): Date =>
  new Date(end.getTime() + DOOR_CODE_RELEASE_HOURS * 3_600_000);

// --- Validation ------------------------------------------------------------

/**
 * TTLock's "too simple" rule, as a conservative superset.
 *
 * TTLock does not publish the rule. This rejects any run of four or more
 * adjacent digits that is all one digit (5555, 66661, 155551) or strictly
 * consecutive by one in either direction (0123, 4321, 12345, 98765), and treats
 * 9->0 and 0->9 as consecutive too (9012, 2109) -- over-strict on purpose.
 *
 * Checked against production responses on 3 Sep 2026. Rejected: 5555, 7777,
 * 6666, 0123, 4321. Accepted: 0111, 0321, 0456, 0789, 0044, 2216, 4664, 1726,
 * 1952, 2868. All of those are in `test/booking-door-code.test.ts`.
 */
export function isTooSimple(code: string): boolean {
  for (let i = 0; i + 4 <= code.length; i += 1) {
    const w = [...code.slice(i, i + 4)].map(Number);
    if (w.every((d) => d === w[0])) return true;
    // Difference mod 10: 1 for ascending (including 9->0), 9 for descending
    // (including 0->9). Anything else breaks the run.
    const step = (a: number, b: number) => (b - a + 10) % 10;
    const s = step(w[0], w[1]);
    if ((s === 1 || s === 9) && step(w[1], w[2]) === s && step(w[2], w[3]) === s) return true;
  }
  return false;
}

/** Digits only, within TTLock's length range, and not too simple. */
export function isAcceptableDoorCode(code: string): boolean {
  if (typeof code !== 'string') return false;
  if (!new RegExp(`^\\d{${MIN_DOOR_CODE_LENGTH},${MAX_DOOR_CODE_LENGTH}}$`).test(code)) return false;
  return !isTooSimple(code);
}

// --- Candidates ------------------------------------------------------------

/**
 * The last four digits of a phone number, or null if it is not one.
 *
 * Ten digits is the door system's own threshold (`Phone:\s*(\+?\d{10,})`), kept
 * here so that "the last four digits of your mobile number" is only ever said
 * about something that is a mobile number. This is also what the door system
 * derived for bookings made before codes were allocated here, so it doubles as
 * the read-side fallback for those (see `doorCodeOf`).
 *
 * No validation: this is the fragment, not the decision.
 */
export function doorCodeFor(phone: string): string | null {
  const digits = normalisePhone(phone).replace(/[^\d]/g, '');
  return digits.length >= 10 ? digits.slice(-4) : null;
}

/** The phone-derived candidate, if there is one and the lock would take it. */
export function phoneDoorCode(phone: string): string | null {
  const fragment = doorCodeFor(phone);
  return fragment && isAcceptableDoorCode(fragment) ? fragment : null;
}

/**
 * A random five-digit code the lock will accept. Zero-padded: "00412" is a valid
 * five-digit code and stays one.
 */
export function generateDoorCode(random: (max: number) => number = randomInt): string {
  for (;;) {
    const code = String(random(10 ** GENERATED_DOOR_CODE_LENGTH)).padStart(GENERATED_DOOR_CODE_LENGTH, '0');
    if (isAcceptableDoorCode(code)) return code;
  }
}

// --- Allocation ------------------------------------------------------------

export class DoorCodeExhaustedError extends Error {
  constructor(attempts: number) {
    super(`Could not find a free door code in ${attempts} attempts.`);
    this.name = 'DoorCodeExhaustedError';
  }
}

export interface AllocateDoorCodeInput {
  phone: string;
  /** A code already allocated to this booking. Returned as-is: allocation is idempotent. */
  existing?: AllocatedDoorCode | null;
  /** Whether a code is free to use right now. The store answers from its reservations. */
  isFree: (code: string) => Promise<boolean> | boolean;
  /** Codes never to hand out, whatever `isFree` says. */
  avoid?: Iterable<string>;
  /** Test seam. */
  generate?: () => string;
  maxAttempts?: number;
}

/**
 * Picks a code for a booking.
 *
 * Preference order: the code the booking already has; the last four digits of
 * the phone number, if the lock would accept them and nothing live is using
 * them; otherwise a random five-digit code. The phone fragment is preferred
 * because it is memorable and needs no separate explanation -- but only when it
 * will actually work, which is the whole point of doing this here.
 */
export async function allocateDoorCode(input: AllocateDoorCodeInput): Promise<AllocatedDoorCode> {
  if (input.existing) return { code: input.existing.code, source: input.existing.source };

  const avoid = new Set(input.avoid ?? []);
  const usable = async (code: string) => !avoid.has(code) && await input.isFree(code);

  const fromPhone = phoneDoorCode(input.phone);
  if (fromPhone && await usable(fromPhone)) return { code: fromPhone, source: 'phone' };

  const generate = input.generate ?? generateDoorCode;
  const attempts = input.maxAttempts ?? 20;
  for (let i = 0; i < attempts; i += 1) {
    const code = generate();
    if (await usable(code)) return { code, source: 'generated' };
  }
  throw new DoorCodeExhaustedError(attempts);
}

// --- Reading a booking's code ----------------------------------------------

/**
 * The code to show a booker, and whether to tell them it is their phone number.
 *
 * Bookings made before allocation moved here carry no `doorCode`. Their code is
 * whatever the door system derived -- the phone fragment -- so that is what is
 * shown, and it is honestly described as the last four digits of their number.
 */
export function doorCodeOf(
  b: { doorCode?: AllocatedDoorCode | null; customer: { phone?: string } },
): AllocatedDoorCode | null {
  if (b.doorCode) return { code: b.doorCode.code, source: b.doorCode.source };
  const legacy = doorCodeFor(b.customer.phone ?? '');
  return legacy ? { code: legacy, source: 'phone' } : null;
}
