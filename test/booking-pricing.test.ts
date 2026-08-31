import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { priceFor, isValidDuration, durationsFor, formatPence, rateAt } from '../src/lib/booking/pricing.ts';
import { DEFAULTS } from '../src/lib/booking/config.ts';
import type { RoomBookingConfig } from '../src/lib/booking/config.ts';
import { londonToInstant, addMinutes } from '../src/lib/booking/time.ts';

const room = (over: Partial<RoomBookingConfig>): RoomBookingConfig => ({
  slug: 'test', shortName: 'Test', calendarId: 'x', hourlyRatePence: 1000,
  ...DEFAULTS, peak: [], openingHours: [...DEFAULTS.openingHours],
  intakeQuestions: [], ...over,
} as RoomBookingConfig);

const SNOOKER = room({ slug: 'snooker-room', hourlyRatePence: 750, bufferMins: 0 });
const STUDIO = room({ slug: 'large-room', hourlyRatePence: 1000, bufferMins: 30 });

const at = (t: string) => londonToInstant('2027-07-15', t);

describe('prices match the DRA rates', () => {
  test('snooker: the three durations seen in real Acuity bookings', () => {
    // These are the exact figures read off live bookings when grounding the spec.
    assert.equal(priceFor(SNOOKER, at('12:00'), addMinutes(at('12:00'), 60)), 750);
    assert.equal(priceFor(SNOOKER, at('12:00'), addMinutes(at('12:00'), 120)), 1500);
    assert.equal(priceFor(SNOOKER, at('12:00'), addMinutes(at('12:00'), 150)), 1875);
  });

  test('snooker: 1h30 is exactly £11.25, no rounding drift', () => {
    assert.equal(priceFor(SNOOKER, at('12:00'), addMinutes(at('12:00'), 90)), 1125);
  });

  test('studio and lounge: £10/hour', () => {
    assert.equal(priceFor(STUDIO, at('12:00'), addMinutes(at('12:00'), 60)), 1000);
    assert.equal(priceFor(STUDIO, at('12:00'), addMinutes(at('12:00'), 240)), 4000);
  });

  test('a full day 08:00-23:00 prices without drift', () => {
    assert.equal(priceFor(STUDIO, at('08:00'), at('23:00')), 15000);
    assert.equal(priceFor(SNOOKER, at('08:00'), at('23:00')), 11250);
  });

  test('zero and inverted intervals are free rather than negative', () => {
    assert.equal(priceFor(STUDIO, at('12:00'), at('12:00')), 0);
    assert.equal(priceFor(STUDIO, at('13:00'), at('12:00')), 0);
  });
});

describe('peak rates -- unused today, but the extension point works', () => {
  const peaky = room({
    hourlyRatePence: 1000,
    peak: [{ days: ['thu'], from: '18:00', to: '22:00', hourlyRatePence: 2000 }],
  });

  test('off-peak uses the base rate', () => {
    assert.equal(rateAt(peaky, at('12:00')), 1000);
  });

  test('inside the window uses the peak rate', () => {
    assert.equal(rateAt(peaky, at('19:00')), 2000);
  });

  test('a booking straddling the boundary is priced per increment, not per booking', () => {
    // 17:00-19:00 on a Thursday: one hour at £10, one hour at £20.
    assert.equal(priceFor(peaky, at('17:00'), at('19:00')), 3000);
  });

  test('the peak window is half-open -- 22:00 is already off-peak', () => {
    assert.equal(rateAt(peaky, at('22:00')), 1000);
  });
});

describe('durations', () => {
  test('minimum is an hour; 45 minutes is never valid', () => {
    assert.equal(isValidDuration(STUDIO, 60), true);
    assert.equal(isValidDuration(STUDIO, 45), false);
    assert.equal(isValidDuration(STUDIO, 30), false);
  });

  test('rises in 30-minute steps', () => {
    for (const d of [60, 90, 120, 150, 180]) assert.equal(isValidDuration(STUDIO, d), true, `${d}`);
    for (const d of [75, 100, 135]) assert.equal(isValidDuration(STUDIO, d), false, `${d}`);
  });

  test('cannot exceed the room maximum', () => {
    assert.equal(isValidDuration(STUDIO, 900), true);
    assert.equal(isValidDuration(STUDIO, 930), false);
  });

  test('offered durations are capped by the free time actually available', () => {
    assert.deepEqual(durationsFor(STUDIO, 150), [60, 90, 120, 150]);
    assert.deepEqual(durationsFor(STUDIO, 59), []);
    assert.deepEqual(durationsFor(STUDIO, 60), [60]);
  });

  test('a 20-minute gap offers nothing at all', () => {
    assert.deepEqual(durationsFor(SNOOKER, 20), []);
  });
});

test('formatPence', () => {
  assert.equal(formatPence(750), '£7.50');
  assert.equal(formatPence(1125), '£11.25');
  assert.equal(formatPence(15000), '£150.00');
});
