import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  londonToInstant, instantToLocalDate, instantToLocalTime, toLondonISO,
  londonOffsetMs, nextQuarterHour, minutesOfDay, mergeIntervals, overlaps, addMinutes,
} from '../src/lib/booking/time.ts';

describe('London <-> instant', () => {
  test('GMT: midwinter is UTC', () => {
    assert.equal(londonToInstant('2027-01-15', '09:00').toISOString(), '2027-01-15T09:00:00.000Z');
  });

  test('BST: midsummer is an hour ahead', () => {
    assert.equal(londonToInstant('2027-07-15', '09:00').toISOString(), '2027-07-15T08:00:00.000Z');
  });

  test('round-trips through local date and time', () => {
    for (const [d, t] of [['2027-01-15', '08:00'], ['2027-07-15', '22:45'], ['2027-03-28', '23:00']]) {
      const i = londonToInstant(d, t);
      assert.equal(instantToLocalDate(i), d, `date ${d} ${t}`);
      assert.equal(instantToLocalTime(i), t, `time ${d} ${t}`);
    }
  });

  test('midnight renders as 00:00, not 24:00', () => {
    // en-GB hour12:false reports midnight as "24"; the module normalises it.
    const i = londonToInstant('2027-06-10', '00:00');
    assert.equal(instantToLocalTime(i), '00:00');
    assert.equal(instantToLocalDate(i), '2027-06-10');
  });
});

describe('2027 DST transitions', () => {
  // Spring forward: 28 Mar 2027, 01:00 GMT -> 02:00 BST.
  test('spring forward: offset flips at the transition', () => {
    assert.equal(londonOffsetMs(new Date('2027-03-28T00:59:00Z')), 0);
    assert.equal(londonOffsetMs(new Date('2027-03-28T01:00:00Z')), 3600000);
  });

  test('spring forward: an opening-hours day is still 15 hours of wall clock', () => {
    const open = londonToInstant('2027-03-28', '08:00');
    const close = londonToInstant('2027-03-28', '23:00');
    assert.equal((close.getTime() - open.getTime()) / 3600000, 15);
  });

  // Fall back: 31 Oct 2027, 02:00 BST -> 01:00 GMT. That day has 25 hours.
  test('fall back: offset flips at the transition', () => {
    assert.equal(londonOffsetMs(new Date('2027-10-31T00:59:00Z')), 3600000);
    assert.equal(londonOffsetMs(new Date('2027-10-31T01:00:00Z')), 0);
  });

  test('fall back: opening hours are still 15 hours, transition is before 08:00', () => {
    const open = londonToInstant('2027-10-31', '08:00');
    const close = londonToInstant('2027-10-31', '23:00');
    assert.equal((close.getTime() - open.getTime()) / 3600000, 15);
    assert.equal(instantToLocalTime(open), '08:00');
  });

  test('every 15-min start on both transition days is distinct and correctly labelled', () => {
    for (const day of ['2027-03-28', '2027-10-31']) {
      const seen = new Set<number>();
      for (let m = 8 * 60; m <= 23 * 60; m += 15) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        const i = londonToInstant(day, `${hh}:${mm}`);
        assert.ok(!seen.has(i.getTime()), `${day} ${hh}:${mm} duplicated an instant`);
        seen.add(i.getTime());
        assert.equal(instantToLocalTime(i), `${hh}:${mm}`, `${day} ${hh}:${mm} mislabelled`);
      }
      assert.equal(seen.size, 61);
    }
  });

  test('ISO carries the real offset, not a hardcoded one', () => {
    assert.match(toLondonISO(londonToInstant('2027-01-15', '09:00')), /\+00:00$/);
    assert.match(toLondonISO(londonToInstant('2027-07-15', '09:00')), /\+01:00$/);
    assert.equal(toLondonISO(londonToInstant('2027-07-15', '09:00')), '2027-07-15T09:00:00+01:00');
  });
});

describe('the quarter-hour rule', () => {
  const q = (iso: string) => toLondonISO(nextQuarterHour(new Date(iso)));

  test('mid-quarter rounds up', () => {
    assert.equal(q('2027-01-15T14:07:00Z'), '2027-01-15T14:15:00+00:00');
  });

  test('exactly on a boundary still moves on -- you cannot book the block you are in', () => {
    assert.equal(q('2027-01-15T14:00:00Z'), '2027-01-15T14:15:00+00:00');
  });

  test('one second past a boundary behaves the same as exactly on it', () => {
    assert.equal(q('2027-01-15T14:00:01Z'), '2027-01-15T14:15:00+00:00');
  });

  test('last quarter of the hour rolls into the next hour', () => {
    assert.equal(q('2027-01-15T14:47:30Z'), '2027-01-15T15:00:00+00:00');
  });
});

describe('intervals', () => {
  const iv = (a: string, b: string) => ({ start: new Date(a), end: new Date(b) });

  test('touching intervals do not overlap', () => {
    assert.equal(overlaps(iv('2027-01-15T14:00:00Z', '2027-01-15T15:00:00Z'),
                          iv('2027-01-15T15:00:00Z', '2027-01-15T16:00:00Z')), false);
  });

  test('genuine overlap is detected', () => {
    assert.equal(overlaps(iv('2027-01-15T14:00:00Z', '2027-01-15T15:00:00Z'),
                          iv('2027-01-15T14:59:00Z', '2027-01-15T16:00:00Z')), true);
  });

  test('merge joins touching and overlapping, leaves gaps alone', () => {
    const merged = mergeIntervals([
      iv('2027-01-15T15:00:00Z', '2027-01-15T16:00:00Z'),
      iv('2027-01-15T14:00:00Z', '2027-01-15T15:00:00Z'),
      iv('2027-01-15T18:00:00Z', '2027-01-15T19:00:00Z'),
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0].start.toISOString(), '2027-01-15T14:00:00.000Z');
    assert.equal(merged[0].end.toISOString(), '2027-01-15T16:00:00.000Z');
  });

  test('merge of nothing is nothing', () => {
    assert.deepEqual(mergeIntervals([]), []);
  });

  test('a fully contained interval does not shrink the one containing it', () => {
    const merged = mergeIntervals([
      iv('2027-01-15T14:00:00Z', '2027-01-15T18:00:00Z'),
      iv('2027-01-15T15:00:00Z', '2027-01-15T16:00:00Z'),
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].end.toISOString(), '2027-01-15T18:00:00.000Z');
  });
});

test('minutesOfDay', () => {
  assert.equal(minutesOfDay('08:00'), 480);
  assert.equal(minutesOfDay('23:00'), 1380);
  assert.equal(minutesOfDay('00:15'), 15);
});

test('addMinutes', () => {
  assert.equal(addMinutes(new Date('2027-01-15T14:00:00Z'), 90).toISOString(), '2027-01-15T15:30:00.000Z');
});
