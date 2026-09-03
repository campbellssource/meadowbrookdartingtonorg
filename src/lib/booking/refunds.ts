// Refunding money that sits in more than one Square payment.
//
// A booking is not one payment. Amending upwards takes a second charge for the
// difference, so an amended booking holds its money in two payments, and a third
// amendment makes three. `paidPence` is the net of the whole ledger.
//
// Every refund path used to pick `payments.find(p => p.kind === 'charge')` -- the
// FIRST completed charge -- and refund the entire amount against it. That works
// only for a booking that was never amended upwards. The DRA hit it on 3 Sep 2026
// cancelling a snooker booking held as £7.50 + £3.75: Square refused the £11.25
// with REFUND_AMOUNT_INVALID, "the requested refund amount exceeds the amount
// available to refund". The endpoint returned 502 and correctly left the booking
// confirmed, so no money moved and nothing was lost -- but the booker could not
// cancel, and neither could the committee, because /admin had the same bug.

import type { Payment } from './store.ts';
import { refund as squareRefund, type SquareConfig } from './square.ts';

export interface RefundSlice {
  squarePaymentId: string;
  amountPence: number;
}

export type RefundPlan =
  | { ok: true; slices: RefundSlice[] }
  | { ok: false; availablePence: number };

/**
 * How much of a charge Square would still accept a refund against.
 *
 * Pending refunds count. Square has already committed the money at that point, and
 * treating a pending refund as unspent would plan a second refund over the top of
 * it -- which Square then refuses, leaving a plan half executed.
 */
function remainingOn(payments: Payment[], charge: Payment): number {
  const refunded = payments
    .filter((p) => p.kind === 'refund'
      && p.squarePaymentId === charge.squarePaymentId
      && (p.status === 'completed' || p.status === 'pending'))
    .reduce((sum, p) => sum + p.amountPence, 0);
  return Math.max(0, charge.amountPence - refunded);
}

/**
 * Split a refund across the payments that actually hold the money.
 *
 * Oldest charge first, which keeps the split stable and matches how a person reads
 * the ledger. Returns the money available instead of a plan when the ledger cannot
 * cover the amount, so the caller can say so rather than half-refunding.
 */
export function planRefund(payments: Payment[], amountPence: number): RefundPlan {
  const charges = payments.filter((p) => p.kind === 'charge' && p.status === 'completed');
  const slices: RefundSlice[] = [];
  let outstanding = amountPence;
  let available = 0;

  for (const charge of charges) {
    const remaining = remainingOn(payments, charge);
    available += remaining;
    if (outstanding <= 0 || remaining <= 0) continue;
    const take = Math.min(remaining, outstanding);
    slices.push({ squarePaymentId: charge.squarePaymentId, amountPence: take });
    outstanding -= take;
  }

  if (outstanding > 0) return { ok: false, availablePence: available };
  return { ok: true, slices };
}

export type RefundOutcome =
  | { ok: true; entries: Omit<Payment, 'at'>[] }
  /**
   * `entries` is what genuinely succeeded before the failure. It must still be
   * written to the ledger: the money has left Square whether or not the rest of the
   * operation completes, and a refund missing from the ledger reads as drift to
   * reconciliation and as an overcharge to the booker.
   */
  | { ok: false; entries: Omit<Payment, 'at'>[]; refundedPence: number; error: unknown };

/**
 * Issue a refund across as many payments as it takes.
 *
 * Idempotency keys are derived from the booking, its history length and the slice
 * index, so a replayed cancellation refunds once. The index rather than the payment
 * id keeps the key inside Square's 45-character limit.
 */
export async function issueRefund(
  cfg: SquareConfig,
  input: {
    ref: string;
    payments: Payment[];
    amountPence: number;
    historyLength: number;
    reason: string;
    ledgerReason: Payment['reason'];
    keyPrefix?: string;
  },
): Promise<RefundOutcome> {
  const plan = planRefund(input.payments, input.amountPence);
  if (!plan.ok) {
    return {
      ok: false, entries: [], refundedPence: 0,
      error: new Error(
        `Cannot refund ${input.amountPence}p: only ${plan.availablePence}p is refundable across `
        + `${input.payments.filter((p) => p.kind === 'charge').length} charge(s).`,
      ),
    };
  }

  const entries: Omit<Payment, 'at'>[] = [];
  let refundedPence = 0;

  for (const [i, slice] of plan.slices.entries()) {
    const idempotencyKey = `${input.keyPrefix ?? input.ref}:${input.historyLength}:${i}`;
    try {
      const result = await squareRefund(cfg, {
        squarePaymentId: slice.squarePaymentId,
        amountPence: slice.amountPence,
        idempotencyKey,
        reason: input.reason,
      });
      entries.push({
        kind: 'refund', amountPence: slice.amountPence,
        squarePaymentId: slice.squarePaymentId, squareRefundId: result.squareRefundId,
        idempotencyKey, status: result.status, reason: input.ledgerReason,
      });
      refundedPence += slice.amountPence;
    } catch (err) {
      // Stop here rather than trying the rest. A second failure would only add
      // noise, and what has already moved is recorded above.
      return { ok: false, entries, refundedPence, error: err };
    }
  }

  return { ok: true, entries };
}
