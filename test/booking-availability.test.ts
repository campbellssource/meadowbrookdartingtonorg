import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeAvailability, inflate, datesBetween, isBookable } from '../src/lib/booking/availability.ts';
import { DEFAULTS } from '../src/lib/booking/config.ts';
import type { RoomBookingConfig } from '../src/lib/booking/config.ts';
import { londonToInstant, addMinutes } from '../src/lib/booking/time.ts';

const mk = (over: Partial<RoomBookingConfig>): RoomBookingConfig => ({
  slug: 'test', shortName: 'Test', calendarId: 'x', hourlyRatePence: 1000,
  ...DEFAULTS, peak: [], openingHours: [...DEFAULTS.openingHours], intakeQuestions: [],
  ...over,
} as RoomBookingConfig);

const STUDIO = mk({ slug: 'large-room', hourlyRatePence: 1000, bufferMins: 30 });
const SNOOKER = mk({ slug: 'snooker-room', hourlyRatePence: 750, bufferMins: 0 });

const DAY = '2027-07-15';
const at = (t: string) => londonToInstant(DAY, t);
const NOW = londonToInstant('2027-07-14', '09:00'); // day before, so nothing is filtered by notice

const run = (room: RoomBookingConfig, busy: { start: string; end: string }[] = [], now = NOW) =>
  computeAvailability({
    room, from: DAY, to: DAY, now,
    busy: busy.map((b) => ({ start: at(b.start), end: at(b.end) })),
  }).days[0];

const startsAt = (day: ReturnType<typeof run>, hhmm: string) =>
  day.slots.some((s) => s.start.startsWith(`${DAY}T${hhmm}`));

describe('opening hours -- 08:00 to 23:00, every day', () => {
  test('no day is ever closed', () => {
    const days = computeAvailability({ room: STUDIO, from: '2027-07-12', to: '2027-07-18', busy: [], now: NOW }).days;
    assert.equal(days.length, 7);
    assert.ok(days.every((d) => d.open), 'every day should be open');
  });

  test('first start is 08:00 and no start is before it', () => {
    const day = run(STUDIO);
    assert.ok(startsAt(day, '08:00'), '08:00 should be bookable');
    assert.ok(!day.slots.some((s) => s.start < `${DAY}T08:00`));
  });

  test('nothing can run past 23:00', () => {
    for (const slot of run(STUDIO).slots) {
      const startMins = Number(slot.start.slice(11, 13)) * 60 + Number(slot.start.slice(14, 16));
      assert.ok(startMins + slot.maxDurationMins <= 23 * 60,
        `${slot.start} + ${slot.maxDurationMins}m runs past closing`);
    }
  });

  test('the last hour is bookable -- 22:00 to 23:00 exactly', () => {
    const day = run(STUDIO);
    const last = day.slots[day.slots.length - 1];
    assert.equal(last.start.slice(11, 16), '22:00');
    assert.equal(last.maxDurationMins, 60);
  });
});

describe('the 15-minute start grid', () => {
  test('every start lands on :00, :15, :30 or :45', () => {
    for (const slot of run(STUDIO).slots) {
      assert.ok(['00', '15', '30', '45'].includes(slot.start.slice(14, 16)), slot.start);
    }
  });

  test('every duration is 60+ in 30-minute steps, and 45 is never offered', () => {
    for (const slot of run(STUDIO).slots) {
      for (const d of slot.durations) {
        assert.ok(d.mins >= 60 && (d.mins - 60) % 30 === 0, `${slot.start} offered ${d.mins}m`);
      }
    }
  });
});

describe('buffer -- the case the spec calls out by name', () => {
  const busy = [{ start: '14:00', end: '15:00' }];

  test('Studio: a 14:00-15:00 booking makes 15:30 the next start, not 15:00 or 15:15', () => {
    const day = run(STUDIO, busy);
    assert.equal(startsAt(day, '15:00'), false, '15:00 must be blocked by the buffer');
    assert.equal(startsAt(day, '15:15'), false, '15:15 must be blocked by the buffer');
    assert.equal(startsAt(day, '15:30'), true, '15:30 must be bookable');
  });

  test('Studio: the buffer also protects the run-up -- 13:30 is the last start before', () => {
    const day = run(STUDIO, busy);
    // A booking must END by 13:30, so with a 60-minute minimum the last usable start is 12:30.
    assert.equal(startsAt(day, '13:30'), false);
    assert.equal(startsAt(day, '12:30'), true);
    const s = day.slots.find((x) => x.start.slice(11, 16) === '12:30')!;
    assert.equal(s.maxDurationMins, 60, '12:30 should only fit an hour before the buffer');
  });

  test('Snooker: the same booking leaves 15:00 bookable -- back-to-back is wanted', () => {
    const day = run(SNOOKER, busy);
    assert.equal(startsAt(day, '15:00'), true, 'snooker sessions should be able to run back to back');
  });

  test('buffer is not applied at the edges of the day', () => {
    // Nothing adjacent to 08:00, so the buffer has nothing to push against.
    assert.equal(startsAt(run(STUDIO), '08:00'), true);
    const day = run(STUDIO, [{ start: '08:00', end: '09:00' }]);
    assert.equal(startsAt(day, '09:30'), true, '30 min after a booking that starts at opening');
  });

  test('inflate widens and merges, and leaves genuine gaps alone', () => {
    const merged = inflate(
      [{ start: at('14:00'), end: at('15:00') }, { start: at('16:00'), end: at('17:00') }],
      30,
    );
    assert.equal(merged.length, 1, 'two bookings an hour apart merge once buffered');
    const far = inflate(
      [{ start: at('10:00'), end: at('11:00') }, { start: at('16:00'), end: at('17:00') }],
      30,
    );
    assert.equal(far.length, 2);
  });
});

describe('the quarter-hour rule, applied to a live day', () => {
  test('at 14:07 the earliest start is 14:15', () => {
    const day = run(SNOOKER, [], new Date(at('14:07').getTime()));
    assert.equal(startsAt(day, '14:00'), false);
    assert.equal(startsAt(day, '14:15'), true);
  });

  test('at 14:00:20 the earliest start is still 14:15 -- you cannot book the block you are in', () => {
    const day = run(SNOOKER, [], new Date(at('14:00').getTime() + 20_000));
    assert.equal(startsAt(day, '14:00'), false);
    assert.equal(startsAt(day, '14:15'), true);
  });

  test('a snooker slot 15 minutes away is genuinely offered -- zero notice, as intended', () => {
    const day = run(SNOOKER, [], new Date(at('14:01').getTime()));
    assert.equal(startsAt(day, '14:15'), true);
  });
});

describe('a fully booked and a nearly full day', () => {
  test('booked 08:00-23:00 leaves nothing', () => {
    assert.deepEqual(run(STUDIO, [{ start: '08:00', end: '23:00' }]).slots, []);
  });

  test('a 90-minute gap is unusable in the Studio -- buffers eat it from both ends', () => {
    // Free 12:00-13:30 between two bookings. A 30-min buffer each side leaves
    // 12:30-13:00: half an hour, below the one-hour minimum.
    const day = run(STUDIO, [{ start: '08:00', end: '12:00' }, { start: '13:30', end: '18:00' }]);
    const inGap = day.slots.filter((s) => {
      const hhmm = s.start.slice(11, 16);
      return hhmm >= '12:00' && hhmm < '13:30';
    });
    assert.deepEqual(inGap, [], 'nothing should be bookable inside the buffered gap');
    // The evening, which is genuinely free, is unaffected.
    assert.equal(startsAt(day, '18:30'), true, 'the evening is still bookable');
  });

  test('the same gap in the Snooker Room fits exactly one 90-minute booking', () => {
    const day = run(SNOOKER, [{ start: '08:00', end: '12:00' }, { start: '13:30', end: '18:00' }]);
    assert.equal(startsAt(day, '12:00'), true);
    const s = day.slots.find((x) => x.start.slice(11, 16) === '12:00')!;
    assert.equal(s.maxDurationMins, 90);
    assert.deepEqual(s.durations.map((d) => d.mins), [60, 90]);
  });

  test('prices ride along with the durations', () => {
    const s = run(SNOOKER).slots[0];
    assert.equal(s.durations[0].pricePence, 750);
    assert.equal(s.durations[1].pricePence, 1125);
  });
});

describe('advance window', () => {
  test('90 days out is bookable, 91 is not', () => {
    const now = londonToInstant('2027-07-15', '09:00');
    const ok = computeAvailability({ room: STUDIO, from: '2027-10-12', to: '2027-10-12', busy: [], now });
    const tooFar = computeAvailability({ room: STUDIO, from: '2027-10-14', to: '2027-10-14', busy: [], now });
    assert.ok(ok.days[0].slots.length > 0, '89 days out should be bookable');
    assert.equal(tooFar.days[0].slots.length, 0, '91 days out should not be');
  });
});

describe('datesBetween', () => {
  test('inclusive of both ends', () => {
    assert.deepEqual(datesBetween('2027-07-15', '2027-07-17'), ['2027-07-15', '2027-07-16', '2027-07-17']);
  });
  test('a single day', () => {
    assert.deepEqual(datesBetween('2027-07-15', '2027-07-15'), ['2027-07-15']);
  });
  test('crosses a DST boundary without losing or repeating a day', () => {
    const d = datesBetween('2027-10-30', '2027-11-01');
    assert.deepEqual(d, ['2027-10-30', '2027-10-31', '2027-11-01']);
  });
});

describe('isBookable -- the write-path guard for Phase 2', () => {
  const busy = [{ start: at('14:00'), end: at('15:00') }];

  test('accepts a clean booking', () => {
    assert.deepEqual(isBookable(SNOOKER, at('10:00'), at('11:00'), busy, NOW), { ok: true });
  });
  test('rejects one that collides', () => {
    assert.equal(isBookable(SNOOKER, at('14:30'), at('15:30'), busy, NOW).ok, false);
  });
  test('rejects one inside the Studio buffer that Snooker would allow', () => {
    assert.equal(isBookable(SNOOKER, at('15:00'), at('16:00'), busy, NOW).ok, true);
    assert.equal(isBookable(STUDIO, at('15:00'), at('16:00'), busy, NOW).ok, false);
  });
  test('rejects off-grid starts', () => {
    const off = new Date(at('10:00').getTime() + 5 * 60_000);
    assert.equal(isBookable(SNOOKER, off, addMinutes(off, 60), [], NOW).reason, 'not-on-grid');
  });
  test('rejects a 45-minute booking', () => {
    assert.equal(isBookable(SNOOKER, at('10:00'), at('10:45'), [], NOW).reason, 'too-short');
  });
  test('rejects a 75-minute booking -- valid length, wrong step', () => {
    assert.equal(isBookable(SNOOKER, at('10:00'), at('11:15'), [], NOW).reason, 'bad-duration');
  });
  test('rejects one running past closing', () => {
    assert.equal(isBookable(SNOOKER, at('22:30'), addMinutes(at('22:30'), 60), [], NOW).reason, 'after-closing');
  });
  test('rejects one in the past', () => {
    assert.equal(isBookable(SNOOKER, at('10:00'), at('11:00'), [], at('12:00')).reason, 'too-soon');
  });
});
