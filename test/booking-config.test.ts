import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  toRoomConfig, resolveCalendarId, isProductionCalendar, assertWritable,
  PRODUCTION_CALENDAR_IDS, DEFAULTS,
} from '../src/lib/booking/config.ts';

const SNOOKER_CAL = PRODUCTION_CALENDAR_IDS[0];

describe('config defaults', () => {
  test('a block with only a calendar and a rate still gets the DRA rules', () => {
    const c = toRoomConfig('snooker-room', { calendarId: 'dev-cal', hourlyRatePence: 750 })!;
    assert.equal(c.slotGranularityMins, 15);
    assert.equal(c.minDurationMins, 60);
    assert.equal(c.durationIncrementMins, 30);
    assert.equal(c.maxAdvanceDays, 90);
    assert.equal(c.minNoticeHours, 0);
    assert.equal(c.openingHours.length, 7);
    assert.ok(c.openingHours.every((h) => h.from === '08:00' && h.to === '23:00'));
  });

  test('no booking block means the room is not bookable', () => {
    assert.equal(toRoomConfig('x', {}), null);
  });

  test('explicit values beat defaults, and zero is respected', () => {
    const c = toRoomConfig('large-room', { calendarId: 'dev', bufferMins: 30, hourlyRatePence: 1000 })!;
    assert.equal(c.bufferMins, 30);
    const s = toRoomConfig('snooker-room', { calendarId: 'dev', bufferMins: 0, hourlyRatePence: 750 })!;
    assert.equal(s.bufferMins, 0, 'a configured 0 must not fall through to a default');
  });

  test('malformed intake questions are dropped rather than crashing', () => {
    const c = toRoomConfig('x', {
      calendarId: 'dev',
      intakeQuestions: [{ key: 'use', label: 'Why?', required: true }, { key: null, label: 'orphan' }],
    })!;
    assert.equal(c.intakeQuestions.length, 1);
    assert.deepEqual(c.intakeQuestions[0], { key: 'use', label: 'Why?', required: true });
  });
});

describe('calendar override and the write guard', () => {
  test('the environment overrides the configured calendar', () => {
    process.env.BOOKING_CALENDAR_LARGE_ROOM = 'dev-studio';
    assert.equal(resolveCalendarId('large-room', 'configured'), 'dev-studio');
    delete process.env.BOOKING_CALENDAR_LARGE_ROOM;
    assert.equal(resolveCalendarId('large-room', 'configured'), 'configured');
  });

  test('production calendars are recognised', () => {
    assert.equal(isProductionCalendar(SNOOKER_CAL), true);
    assert.equal(isProductionCalendar('something-else'), false);
  });

  test('reads are allowed against a live calendar outside production', () => {
    // Phase 1 compares real availability against Acuity from a laptop; blocking
    // that would defeat the acceptance test.
    assert.doesNotThrow(() => toRoomConfig('snooker-room', { calendarId: SNOOKER_CAL }));
  });

  test('writes are refused against a live calendar outside production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    assert.throws(() => assertWritable({ slug: 'snooker-room', calendarId: SNOOKER_CAL }), /Refusing to write/);
    assert.doesNotThrow(() => assertWritable({ slug: 'snooker-room', calendarId: 'dev-cal' }));
    process.env.NODE_ENV = prev;
  });

  test('writes are allowed in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    assert.doesNotThrow(() => assertWritable({ slug: 'snooker-room', calendarId: SNOOKER_CAL }));
    process.env.NODE_ENV = prev;
  });
});
