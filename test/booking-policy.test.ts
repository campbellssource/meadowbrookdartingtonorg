import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { refundFor, refundableAtBooking, CANCELLATION_WINDOW_HOURS } from '../src/lib/booking/policy.ts';
import { londonToInstant, addMinutes } from '../src/lib/booking/time.ts';

const start = londonToInstant('2027-01-15', '14:00');
const cancel = (paid: number, now: Date) =>
  refundFor({ paidPence: paid, currentPence: paid, start, change: 'cancel' }, now);
const amend = (paid: number, next: number, now: Date) =>
  refundFor({ paidPence: paid, currentPence: paid, newPence: next, start, change: 'amend' }, now);

describe('the one-hour cancellation window', () => {
  test('the window is one hour', () => {
    assert.equal(CANCELLATION_WINDOW_HOURS, 1);
  });

  test('cancelling well ahead refunds everything', () => {
    assert.deepEqual(cancel(1125, addMinutes(start, -24 * 60)),
      { refundPence: 1125, chargePence: 0, reason: 'cancel' });
  });

  test('cancelling 61 minutes before still refunds', () => {
    assert.equal(cancel(1125, addMinutes(start, -61)).refundPence, 1125);
  });

  test('cancelling 59 minutes before refunds nothing', () => {
    assert.deepEqual(cancel(1125, addMinutes(start, -59)),
      { refundPence: 0, chargePence: 0, reason: 'none' });
  });

  test('exactly one hour before is inside the window -- strictly more than is required', () => {
    assert.equal(cancel(1125, addMinutes(start, -60)).refundPence, 0);
  });

  test('cancelling after the start refunds nothing', () => {
    assert.equal(cancel(1125, addMinutes(start, 30)).refundPence, 0);
  });
});

describe('the checkout warning uses the same function as the refund', () => {
  test('a booking made a day ahead is refundable', () => {
    assert.equal(refundableAtBooking(start, addMinutes(start, -24 * 60)), true);
  });

  test('a booking made 15 minutes ahead is not -- the snooker case', () => {
    // minNoticeHours is 0, so this is reachable in every room: non-refundable
    // the instant it is paid for.
    assert.equal(refundableAtBooking(start, addMinutes(start, -15)), false);
  });

  test('warning and behaviour agree at the boundary', () => {
    for (const mins of [-121, -61, -60, -59, -1]) {
      const now = addMinutes(start, mins);
      assert.equal(
        refundableAtBooking(start, now),
        cancel(1000, now).refundPence > 0,
        `disagreement at ${mins} minutes before start`,
      );
    }
  });
});

describe('amendments', () => {
  const early = addMinutes(start, -48 * 60);

  test('a longer slot charges the difference', () => {
    assert.deepEqual(amend(1000, 1500, early), { refundPence: 0, chargePence: 500, reason: 'amend-up' });
  });

  test('a shorter slot refunds the difference', () => {
    assert.deepEqual(amend(1500, 1000, early), { refundPence: 500, chargePence: 0, reason: 'amend-down' });
  });

  test('the same price moves no money', () => {
    assert.deepEqual(amend(1000, 1000, early), { refundPence: 0, chargePence: 0, reason: 'none' });
  });

  test('amending stays priced on the difference even inside the cancellation window', () => {
    // Shortening late is not the same as cancelling late: the room is still being
    // used, so the hirer is charged for what they use rather than penalised.
    assert.deepEqual(amend(1500, 1000, addMinutes(start, -30)),
      { refundPence: 500, chargePence: 0, reason: 'amend-down' });
  });
});
