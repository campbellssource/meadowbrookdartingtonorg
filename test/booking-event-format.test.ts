import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSummary, buildDescription, normalisePhone, durationLabel,
  readPassCode, setPassCodeLine, passCodeLine,
} from '../src/lib/booking/event-format.ts';
import { doorCodeFor } from '../src/lib/booking/door-code.ts';
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
  passCode: '2868',
};

// The line the door system reads the code from, exactly. Label, colon, one
// space, digits, nothing else -- and a whole line of its own.
const PASS_CODE_LINE_RE = /^Pass Code: \d{4,9}$/m;

describe('the door system can parse what we write', () => {
  test('the Phone: line is untouched, since the door system still reads it', () => {
    const d = buildDescription(fields);
    const m = d.match(PHONE_RE);
    assert.ok(m, 'Phone: line must match the door system regex');
    assert.equal(m![1], '07725972868');
    assert.ok(d.split('\n').includes('Phone: 07725972868'));
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

describe('the Pass Code line', () => {
  test('is its own line, exactly "Pass Code: <digits>"', () => {
    const d = buildDescription(fields);
    assert.ok(d.split('\n').includes('Pass Code: 2868'), d);
    assert.match(d, PASS_CODE_LINE_RE);
    assert.equal(readPassCode(d), '2868');
  });

  test('directly follows the Phone: line', () => {
    const lines = buildDescription(fields).split('\n');
    const phone = lines.indexOf('Phone: 07725972868');
    assert.ok(phone >= 0);
    assert.equal(lines[phone + 1], 'Pass Code: 2868');
  });

  test('a five-digit generated code', () => {
    const d = buildDescription({ ...fields, passCode: '48213' });
    assert.ok(d.split('\n').includes('Pass Code: 48213'));
    assert.equal(readPassCode(d), '48213');
  });

  test('a leading zero survives, as a string', () => {
    const d = buildDescription({ ...fields, passCode: '0044' });
    assert.ok(d.split('\n').includes('Pass Code: 0044'));
    assert.ok(!d.includes('Pass Code: 44'));
    assert.equal(readPassCode(d), '0044');
    assert.equal(typeof readPassCode(d), 'string');
  });

  test('is omitted, not left blank, when there is no code', () => {
    const d = buildDescription({ ...fields, passCode: null });
    assert.equal(d.split('\n').some((l) => l.startsWith('Pass Code')), false);
    assert.equal(readPassCode(d), null);
  });

  test('is still a whole line when the test marker is prepended', () => {
    const d = buildDescription({ ...fields, isTest: true });
    assert.match(d, PASS_CODE_LINE_RE);
    assert.equal(readPassCode(d), '2868');
  });

  test('a mangled line reads as absent rather than half-parsed', () => {
    assert.equal(readPassCode('Phone: 07725972868\nPass Code:2868\nEmail: x'), null);
    assert.equal(readPassCode('Phone: 07725972868\nPass Code: 2868 (old)\nEmail: x'), null);
    assert.equal(readPassCode('Phone: 07725972868\nPass Code: 28\nEmail: x'), null);
    assert.equal(readPassCode('Pass Code: 2868\r\nEmail: x'), '2868', 'a CRLF client is tolerated');
  });

  test('passCodeLine formats a string and never a number', () => {
    assert.equal(passCodeLine('0044'), 'Pass Code: 0044');
  });
});

describe('rewriting the Pass Code line on an existing event', () => {
  const original = buildDescription(fields);

  test('replaces the line in place and changes nothing else', () => {
    const next = setPassCodeLine(original, '48213');
    const before = original.split('\n'); const after = next.split('\n');
    assert.equal(after.length, before.length);
    for (let i = 0; i < before.length; i += 1) {
      if (before[i].startsWith('Pass Code')) assert.equal(after[i], 'Pass Code: 48213');
      else assert.equal(after[i], before[i], `line ${i} must be untouched`);
    }
    assert.equal(readPassCode(next), '48213');
  });

  test('the Phone: line is byte-for-byte as it was', () => {
    const next = setPassCodeLine(original, '48213');
    assert.equal(next.match(PHONE_RE)![0], original.match(PHONE_RE)![0]);
  });

  test('inserts directly after Phone: when the event predates the line', () => {
    const legacy = buildDescription({ ...fields, passCode: null });
    const lines = setPassCodeLine(legacy, '0044').split('\n');
    assert.equal(lines[lines.indexOf('Phone: 07725972868') + 1], 'Pass Code: 0044');
    assert.equal(lines.length, legacy.split('\n').length + 1);
  });

  test('appends when there is no Phone: line to follow', () => {
    assert.equal(setPassCodeLine('Name: A Hirer\nEmail: a@b.co', '48213'),
      'Name: A Hirer\nEmail: a@b.co\nPass Code: 48213');
  });

  test('never leaves two Pass Code lines', () => {
    const doubled = `${original}\nPass Code: 1111`;
    const next = setPassCodeLine(doubled, '48213');
    assert.equal(next.split('\n').filter((l) => l.startsWith('Pass Code')).length, 1);
    assert.equal(readPassCode(next), '48213');
  });

  test('is idempotent', () => {
    const once = setPassCodeLine(original, '48213');
    assert.equal(setPassCodeLine(once, '48213'), once);
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

describe('user text cannot impersonate the calendar contract', () => {
  const attack = (name: string) => buildDescription({ ...fields, name });

  test('a name containing "Phone:" cannot hijack the phone line', () => {
    // Without sanitising, the injected line would match first.
    const d = attack('Bob Phone: 07711111111');
    assert.equal(d.match(PHONE_RE)![1], '07725972868',
      'the real phone number must still be the one the door system reads');
  });

  test('a name containing "Pass Code:" cannot plant a second code', () => {
    for (const name of ['Bob Pass Code: 1111', 'Bob\nPass Code: 1111', 'Bob PassCode: 1111', 'pass code: 1111']) {
      const d = attack(name);
      assert.equal(readPassCode(d), '2868', JSON.stringify(name));
      assert.equal(d.split('\n').filter((l) => /^Pass\s*Code:/i.test(l)).length, 1, JSON.stringify(name));
    }
  });

  test('a newline in a name cannot add a line', () => {
    const d = attack('Bob\nPhone: 07711111111');
    assert.equal(d.match(PHONE_RE)![1], '07725972868');
    assert.equal(d.split('\n').filter((l) => l.startsWith('Phone:')).length, 1);
  });

  test('a name cannot forge a second Name: line', () => {
    const d = attack('Bob\nName: Someone Else');
    assert.equal(d.match(NAME_RE)![1].trim().startsWith('Bob'), true);
    assert.equal(d.split('\n').filter((l) => l.trim().startsWith('Name:')).length, 1);
  });

  test('a name cannot forge the test-event marker', () => {
    // That marker decides what cleanup is allowed to delete from live calendars.
    const s = buildSummary({ ...fields, name: 'Bob [TEST EVENT]' });
    assert.equal(s.includes('[TEST EVENT]'), false);
    assert.equal(attack('Bob [test event]').includes('TEST EVENT'), false);
  });

  test('a genuine test booking still gets its marker', () => {
    assert.equal(buildSummary({ ...fields, isTest: true }).startsWith('[TEST EVENT] '), true);
  });

  test('ordinary names are left alone', () => {
    for (const n of ["Jody Fendick", "Siân O'Connor", 'Jean-Luc Baptiste', 'Dr A. Smith']) {
      assert.equal(buildDescription({ ...fields, name: n }).match(NAME_RE)![1].trim(), n, n);
    }
  });
});
