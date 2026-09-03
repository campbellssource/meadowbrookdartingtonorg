import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planRefund } from '../src/lib/booking/refunds.ts';
import type { Payment } from '../src/lib/booking/store.ts';

// A booking is not one payment. Amending upwards takes a second charge for the
// difference, so an amended booking holds its money across several payments.
//
// Every refund path used to refund the whole amount against the FIRST completed
// charge. The DRA hit it on 3 Sep 2026 cancelling a snooker booking held as
// £7.50 + £3.75: Square refused the £11.25 with REFUND_AMOUNT_INVALID. The
// endpoint returned 502 and left the booking confirmed, so nothing was lost -- but
// neither the booker nor /admin could cancel it.

const pay = (p: Partial<Payment> & Pick<Payment, 'kind' | 'amountPence' | 'squarePaymentId'>): Payment =>
  ({ status: 'completed', squareRefundId: null, idempotencyKey: 'k', reason: null, at: null, ...p }) as unknown as Payment;

const charge = (amountPence: number, squarePaymentId: string, status: Payment['status'] = 'completed') =>
  pay({ kind: 'charge', amountPence, squarePaymentId, status });

const refunded = (amountPence: number, squarePaymentId: string, status: Payment['status'] = 'completed') =>
  pay({ kind: 'refund', amountPence, squarePaymentId, status });

describe('planning a refund across payments', () => {
  test('the booking that broke: £7.50 + £3.75 refunds as two slices', () => {
    const plan = planRefund([charge(750, 'A'), charge(375, 'B')], 1125);
    assert.ok(plan.ok);
    assert.deepEqual(plan.slices, [
      { squarePaymentId: 'A', amountPence: 750 },
      { squarePaymentId: 'B', amountPence: 375 },
    ]);
  });

  test('a single charge still refunds as one slice', () => {
    const plan = planRefund([charge(750, 'A')], 750);
    assert.ok(plan.ok);
    assert.deepEqual(plan.slices, [{ squarePaymentId: 'A', amountPence: 750 }]);
  });

  test('a partial refund takes only what it needs, oldest charge first', () => {
    const plan = planRefund([charge(750, 'A'), charge(375, 'B')], 800);
    assert.ok(plan.ok);
    assert.deepEqual(plan.slices, [
      { squarePaymentId: 'A', amountPence: 750 },
      { squarePaymentId: 'B', amountPence: 50 },
    ]);
  });

  test('a charge already fully refunded is skipped, not refunded twice', () => {
    const plan = planRefund([charge(750, 'A'), refunded(750, 'A'), charge(375, 'B')], 375);
    assert.ok(plan.ok);
    assert.deepEqual(plan.slices, [{ squarePaymentId: 'B', amountPence: 375 }]);
  });

  test('a part-refunded charge offers only its remainder', () => {
    const plan = planRefund([charge(750, 'A'), refunded(250, 'A')], 500);
    assert.ok(plan.ok);
    assert.deepEqual(plan.slices, [{ squarePaymentId: 'A', amountPence: 500 }]);
  });

  // Square has already committed the money on a pending refund. Treating it as
  // unspent plans a second refund over the top, which Square then refuses -- leaving
  // a multi-slice plan half executed.
  test('a pending refund counts against what is left', () => {
    const plan = planRefund([charge(750, 'A'), refunded(250, 'A', 'pending')], 750);
    assert.ok(!plan.ok);
    assert.equal(plan.availablePence, 500);
  });

  test('a failed refund does not count against what is left', () => {
    const plan = planRefund([charge(750, 'A'), refunded(250, 'A', 'failed')], 750);
    assert.ok(plan.ok);
    assert.deepEqual(plan.slices, [{ squarePaymentId: 'A', amountPence: 750 }]);
  });

  test('asking for more than the ledger holds refuses rather than half-refunding', () => {
    const plan = planRefund([charge(750, 'A'), charge(375, 'B')], 2000);
    assert.ok(!plan.ok);
    assert.equal(plan.availablePence, 1125);
  });

  test('pending and failed charges hold no money to refund', () => {
    const plan = planRefund([charge(750, 'A', 'pending'), charge(375, 'B', 'failed')], 100);
    assert.ok(!plan.ok);
    assert.equal(plan.availablePence, 0);
  });

  test('three charges, from two amendments upwards', () => {
    const plan = planRefund([charge(750, 'A'), charge(375, 'B'), charge(375, 'C')], 1500);
    assert.ok(plan.ok);
    assert.equal(plan.slices.length, 3);
    assert.equal(plan.slices.reduce((s, x) => s + x.amountPence, 0), 1500);
  });

  test('no slice is ever zero, so no empty refund is sent to Square', () => {
    const plan = planRefund([charge(750, 'A'), charge(375, 'B')], 750);
    assert.ok(plan.ok);
    assert.deepEqual(plan.slices, [{ squarePaymentId: 'A', amountPence: 750 }]);
    assert.ok(plan.slices.every((s) => s.amountPence > 0));
  });
});
