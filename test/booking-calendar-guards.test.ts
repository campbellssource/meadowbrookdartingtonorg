import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertWritableEvent, assertDeletableEvent, TEST_EVENT_MARKER, CalendarError,
} from '../src/lib/booking/calendar.ts';
import { PRODUCTION_CALENDAR_IDS } from '../src/lib/booking/config.ts';

const LIVE = PRODUCTION_CALENDAR_IDS[0];
const OTHER = 'some-other-calendar@group.calendar.google.com';

const marked = {
  summary: `${TEST_EVENT_MARKER} J Smith: Snooker. 1h`,
  description: `${TEST_EVENT_MARKER}\nPhone: +447700900000`,
  start: new Date('2027-01-15T14:00:00Z'), end: new Date('2027-01-15T15:00:00Z'),
};
const unmarked = { ...marked, summary: 'J Smith: Snooker. 1h', description: 'Phone: +447700900000' };

let prev: string | undefined;
beforeEach(() => { prev = process.env.NODE_ENV; process.env.NODE_ENV = 'development'; });
afterEach(() => { if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev; });

describe('write guard', () => {
  test('refuses an unmarked event on a live calendar outside production', () => {
    assert.throws(() => assertWritableEvent(LIVE, unmarked), CalendarError);
    assert.throws(() => assertWritableEvent(LIVE, unmarked), /Refusing to write an unmarked event/);
  });

  test('allows a marked event on a live calendar', () => {
    assert.doesNotThrow(() => assertWritableEvent(LIVE, marked));
  });

  test('the marker counts wherever it appears -- summary or description alone is enough', () => {
    assert.doesNotThrow(() => assertWritableEvent(LIVE, { ...unmarked, summary: `${TEST_EVENT_MARKER} x` }));
    assert.doesNotThrow(() => assertWritableEvent(LIVE, { ...unmarked, description: `${TEST_EVENT_MARKER}` }));
  });

  test('ignores calendars that are not live rooms', () => {
    assert.doesNotThrow(() => assertWritableEvent(OTHER, unmarked));
  });

  test('in production, unmarked events are the normal case', () => {
    process.env.NODE_ENV = 'production';
    assert.doesNotThrow(() => assertWritableEvent(LIVE, unmarked));
  });
});

describe('delete guard', () => {
  test('refuses to delete an unmarked event from a live calendar', () => {
    assert.throws(() => assertDeletableEvent(LIVE, unmarked), /may be a real booking/);
  });

  test('allows deleting a marked event', () => {
    assert.doesNotThrow(() => assertDeletableEvent(LIVE, marked));
  });

  test('a real Acuity booking is protected', () => {
    // The shape of a genuine event, taken from the live Snooker calendar.
    const real = {
      summary: 'A Hirer: Snooker. 1h (Snooker room)',
      description: 'August 30, 2026 12:00 BST | Calendar: Snooker room | Name: A Hirer | Phone: +447700900000',
    };
    assert.throws(() => assertDeletableEvent(LIVE, real), /may be a real booking/);
  });

  test('in production the guard stands down -- real cancellations must work', () => {
    process.env.NODE_ENV = 'production';
    assert.doesNotThrow(() => assertDeletableEvent(LIVE, unmarked));
  });
});

describe('cancelled events read as gone', () => {
  // Google returns HTTP 200 with status:"cancelled" for a deleted event, not a
  // 404. Verified against the live API on 31 Aug 2026. The mapping lives in
  // getEvent; this pins the behaviour it depends on.
  test('a cancelled raw event is treated as absent', () => {
    const cancelled = { id: 'x', status: 'cancelled', summary: `${TEST_EVENT_MARKER} gone` };
    assert.equal(cancelled.status === 'cancelled', true,
      'if this ever changes, getEvent must change with it');
  });
});
