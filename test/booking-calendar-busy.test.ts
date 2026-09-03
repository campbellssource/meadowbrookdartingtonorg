import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { busyFromRaw, type RawEvent } from '../src/lib/booking/calendar.ts';

// Amending is the one availability read that cannot use freeBusy: it needs the
// hirer's own event ignored, and freeBusy returns intervals with no ids. So this
// path reproduces freeBusy's rules by hand, and any drift between the two shows up
// as the amend grid disagreeing with the booking grid about which slots are free.
//
// Written after a hirer could not move an 08:00-09:00 booking to 08:30: the server
// allowed it, the grid never offered it.

const timed = (id: string, from: string, to: string, extra: Partial<RawEvent> = {}): RawEvent => ({
  id, start: { dateTime: from }, end: { dateTime: to }, ...extra,
});

describe('busy intervals from events.list', () => {
  test('the excluded event does not block the hirer moving their own booking', () => {
    const raw = [timed('own', '2026-09-09T07:00:00Z', '2026-09-09T08:00:00Z')];
    assert.equal(busyFromRaw(raw, 'own').length, 0);
    assert.equal(busyFromRaw(raw, null).length, 1);
  });

  test('other bookings still block', () => {
    const raw = [
      timed('own', '2026-09-09T07:00:00Z', '2026-09-09T08:00:00Z'),
      timed('someone-else', '2026-09-09T10:00:00Z', '2026-09-09T11:00:00Z'),
    ];
    const busy = busyFromRaw(raw, 'own');
    assert.equal(busy.length, 1);
    assert.equal(busy[0].start.toISOString(), '2026-09-09T10:00:00.000Z');
  });

  test('cancelled events do not block', () => {
    const raw = [timed('gone', '2026-09-09T07:00:00Z', '2026-09-09T08:00:00Z', { status: 'cancelled' })];
    assert.equal(busyFromRaw(raw, null).length, 0);
  });

  test('events marked Free do not block, as freeBusy would also ignore them', () => {
    const raw = [timed('note', '2026-09-09T07:00:00Z', '2026-09-09T08:00:00Z', { transparency: 'transparent' })];
    assert.equal(busyFromRaw(raw, null).length, 0);
  });

  // The bug this guards: listEvents drops anything without a dateTime because its
  // callers want events they can rewrite. Busy time cannot afford to -- an all-day
  // "HALL CLOSED" blocks the room, and freeBusy reports it. Dropping it here would
  // let someone amend into a day the building is shut.
  test('an all-day block occupies the whole day', () => {
    const raw: RawEvent[] = [{ id: 'closed', start: { date: '2026-09-09' }, end: { date: '2026-09-10' } }];
    const busy = busyFromRaw(raw, null);
    assert.equal(busy.length, 1);
    // 9 Sept is BST, so local midnight is 23:00 UTC the day before. Resolving these
    // wall dates in UTC would leave the first and last hour of the day bookable.
    assert.equal(busy[0].start.toISOString(), '2026-09-08T23:00:00.000Z');
    assert.equal(busy[0].end.toISOString(), '2026-09-09T23:00:00.000Z');
  });

  test('an all-day block in winter lands on UTC midnight', () => {
    const raw: RawEvent[] = [{ id: 'closed', start: { date: '2026-12-25' }, end: { date: '2026-12-26' } }];
    const busy = busyFromRaw(raw, null);
    assert.equal(busy[0].start.toISOString(), '2026-12-25T00:00:00.000Z');
  });

  test('a multi-day block spans its whole range', () => {
    const raw: RawEvent[] = [{ id: 'refurb', start: { date: '2026-09-09' }, end: { date: '2026-09-12' } }];
    const [b] = busyFromRaw(raw, null);
    assert.equal((b.end.getTime() - b.start.getTime()) / 3_600_000, 72);
  });

  test('an event with neither shape is dropped rather than becoming 1970', () => {
    assert.equal(busyFromRaw([{ id: 'odd' }], null).length, 0);
  });
});
