import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSummary, buildDescription, normalisePhone, doorCodeFor, durationLabel,
} from '../src/lib/booking/event-format.ts';
import { DEFAULTS } from '../src/lib/booking/config.ts';
import type { RoomBookingConfig } from '../src/lib/booking/config.ts';
import { londonToInstant, addMinutes } from '../src/lib/booking/time.ts';

// --- Copied verbatim from calendartopasscode, 31 Aug 2026 -------------------
// If the door system changes these, these tests should fail and force us to look.
const PHONE_RE = /Phone:\s*(\+?\d{10,})/;
const NAME_RE = /^\s*Name:\s*(.+)$/mi;
const stripCalendarName = (title: string) => title.replace(/\s*\([^)]+\)\s*$/, '').trim();

const room = (slug: string, over: Partial<RoomBookingConfig> = {}): RoomBookingConfig => ({
  slug, shortName: 'Room', calendarId: 'x', hourlyRatePence: 1000,
  ...DEFAULTS, peak: [], openingHours: [...DEFAULTS.openingHours], intakeQuestions: [], ...over,
} as RoomBookingConfig);

const start = londonToInstant('2026-10-14', '19:00');
const fields = {
  room: room('snooker-room', { shortName: 'Snooker Room' }),
  name: 'Jody Fendick', phone: '07725972868', email: 'j@example.com',
  start, end: addMinutes(start, 90), pricePence: 1125, reference: 'MB-7K2QX4',
};

describe('the door system can parse what we write', () => {
  test('phone is extractable and yields the expected door code', () => {
    const d = buildDescription(fields);
    const m = d.match(PHONE_RE);
    assert.ok(m, 'Phone: line must match the door system regex');
    assert.equal(m![1].replace(/\D/g, '').slice(-4), '2868');
    assert.equal(doorCodeFor(fields.phone), '2868');
  });

  test('a spaced phone number is normalised, because the regex needs contiguous digits', () => {
    // "07725 972868" would break \d{10,} at five digits and yield no door code.
    const spaced = buildDescription({ ...fields, phone: '07725 972868' });
    assert.ok(PHONE_RE.test(spaced), 'spaces must be stripped or the code is never issued');
    assert.equal(spaced.match(PHONE_RE)![1], '07725972868');
  });

  test('an international number survives with its +', () => {
    const intl = buildDescription({ ...fields, phone: '+44 7725 972868' });
    assert.equal(intl.match(PHONE_RE)![1], '+447725972868');
    assert.equal(doorCodeFor('+44 7725 972868'), '2868');
  });

  test('name is extractable and on its own line', () => {
    const m = buildDescription(fields).match(NAME_RE);
    assert.ok(m);
    assert.equal(m![1].trim(), 'Jody Fendick');
  });

  test('the name regex still works when the test marker is prepended', () => {
    const m = buildDescription({ ...fields, isTest: true }).match(NAME_RE);
    assert.ok(m, 'the marker must not push Name: off its own line');
    assert.equal(m![1].trim(), 'Jody Fendick');
  });

  test('too short a number yields no door code rather than a wrong one', () => {
    assert.equal(doorCodeFor('12345'), null);
    assert.equal(PHONE_RE.test(buildDescription({ ...fields, phone: '12345' })), false);
  });
});

describe('title matches the format the lock label is built from', () => {
  test('shaped like the real Acuity titles', () => {
    assert.equal(buildSummary(fields), 'Jody Fendick: Snooker room. 1h 30mins (Snooker room)');
  });

  test('stripping the calendar name leaves the passcode label', () => {
    assert.equal(stripCalendarName(buildSummary(fields)), 'Jody Fendick: Snooker room. 1h 30mins');
  });

  test('the studio and lounge match their observed wording', () => {
    const s = buildSummary({ ...fields, room: room('large-room'), end: addMinutes(start, 240) });
    assert.equal(s, 'Jody Fendick: Large room. 4h (Studio - Large room)');
    const l = buildSummary({ ...fields, room: room('small-room'), end: addMinutes(start, 90) });
    assert.equal(l, 'Jody Fendick: Small Room. 1h 30mins (Lounge - Small room)');
  });

  test('a test event is still parseable after the marker is added', () => {
    const s = buildSummary({ ...fields, isTest: true });
    assert.ok(s.startsWith('[TEST EVENT] '));
    assert.equal(stripCalendarName(s), '[TEST EVENT] Jody Fendick: Snooker room. 1h 30mins');
  });
});

describe('duration wording', () => {
  test('matches the observed forms', () => {
    assert.equal(durationLabel(60), '1h');
    assert.equal(durationLabel(90), '1h 30mins');
    assert.equal(durationLabel(240), '4h');
    assert.equal(durationLabel(150), '2h 30mins');
  });
});

test('normalisePhone', () => {
  assert.equal(normalisePhone('07725 972868'), '07725972868');
  assert.equal(normalisePhone('+44 (0)7725-972868'), '+4407725972868');
  assert.equal(normalisePhone('  07725972868  '), '07725972868');
});
