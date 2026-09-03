import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleForCalendarRestore } from '../src/lib/booking/store.ts';

// The reconcile sweep recreates a calendar event for a confirmed booking that has
// none, because a paid booking whose room is not blocked is the worst state to be in.
//
// On 3 Sep 2026, minutes after 862 Acuity bookings were imported, it did that to the
// two future ones. Imported bookings carry calendarEventId: null by design -- the
// event already exists, written by Acuity years ago -- and the sweep read that null
// as "not blocked". It duplicated both, double-booking two rooms against themselves,
// and because writing a calendar event is what provisions a door passcode, it asked
// the locks for two more codes.

const at = (iso: string) => ({ toDate: () => new Date(iso) }) as any;
const NOW = new Date('2026-09-03T12:00:00Z');

const booking = (over: Record<string, unknown> = {}) =>
  ({ status: 'confirmed', end: at('2026-09-30T12:00:00Z'), source: 'meadowbrook', ...over }) as any;

describe('which bookings may have a calendar event recreated', () => {
  test('an ordinary future confirmed booking may', () => {
    assert.equal(eligibleForCalendarRestore(booking(), NOW), true);
  });

  // The one that actually happened.
  test('an imported Acuity booking may NOT, however confirmed and future it is', () => {
    assert.equal(eligibleForCalendarRestore(booking({ source: 'acuity' }), NOW), false);
  });

  test('a booking with no source is treated as ours, since the field postdates them', () => {
    assert.equal(eligibleForCalendarRestore(booking({ source: undefined }), NOW), true);
  });

  test('a cancelled booking may not', () => {
    assert.equal(eligibleForCalendarRestore(booking({ status: 'cancelled' }), NOW), false);
  });

  test('a booking that has already finished may not', () => {
    assert.equal(eligibleForCalendarRestore(booking({ end: at('2026-09-01T12:00:00Z') }), NOW), false);
  });

  test('an imported booking is refused before the date is even considered', () => {
    assert.equal(
      eligibleForCalendarRestore(booking({ source: 'acuity', end: at('2027-01-01T00:00:00Z') }), NOW),
      false,
    );
  });
});
