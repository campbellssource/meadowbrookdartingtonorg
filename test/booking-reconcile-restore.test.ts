import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleForCalendarRestore } from '../src/lib/booking/store.ts';
import { lookupEvent, CalendarError } from '../src/lib/booking/calendar.ts';

// The reconcile sweep recreates a calendar event for a confirmed booking that has
// none, because a paid booking whose room is not blocked is the worst state to be in.
//
// On 3 Sep 2026, minutes after 862 Acuity bookings were imported, it did that to the
// two future ones. Imported bookings carry calendarEventId: null by design -- the
// event already exists, written by Acuity years ago -- and the sweep read that null
// as "not blocked". It duplicated both, double-booking two rooms against themselves,
// and because writing a calendar event is what provisions a door passcode, it asked
// the locks for two more codes.
//
// The second way it duplicated events, fixed 3 Sep 2026: a failed *read* of an
// existing event was treated as the event being gone. Every Google wobble
// recreated the event of every booking the sweep checked.

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

describe('reading the event before deciding whether to recreate it', () => {
  const event = { id: 'e1', summary: 's', description: 'd', start: NOW, end: NOW };

  test('an event that is there is present', async () => {
    assert.deepEqual(await lookupEvent('cal', 'e1', async () => event), { status: 'present', event });
  });

  test('a positive "not there" from Google is gone -- the only answer that may recreate', async () => {
    assert.deepEqual(await lookupEvent('cal', 'e1', async () => null), { status: 'gone' });
  });

  test('a failed read is unknown, never gone', async () => {
    for (const status of [500, 503, 429, 401]) {
      const error = new CalendarError(`getEvent failed: ${status}`, status);
      const r = await lookupEvent('cal', 'e1', async () => { throw error; });
      assert.equal(r.status, 'unknown', `HTTP ${status}`);
      assert.equal((r as { error: unknown }).error, error);
    }
  });

  test('a network failure is unknown too', async () => {
    const r = await lookupEvent('cal', 'e1', async () => { throw new TypeError('fetch failed'); });
    assert.equal(r.status, 'unknown');
  });
});
