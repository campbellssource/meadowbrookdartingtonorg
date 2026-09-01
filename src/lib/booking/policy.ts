// Booking policy: what money moves, and when.
//
// One function, pure and exhaustively tested, because the same arithmetic decides
// what the booking form promises and what the refund actually does. Two
// implementations would eventually disagree, and the hirer would be the one to
// find out.

import { MINUTE } from './time.ts';

/**
 * Cancel more than this many hours before the start for a full refund.
 * Inside it, nothing. DRA decision, 31 Aug 2026.
 */
export const CANCELLATION_WINDOW_HOURS = 1;

export type Change = 'cancel' | 'amend';

export interface RefundDecision {
  refundPence: number;
  /** Positive when the hirer owes more, e.g. amending to a longer slot. */
  chargePence: number;
  reason: 'cancel' | 'amend-up' | 'amend-down' | 'none';
}

/** Would cancelling right now refund anything? */
export function refundableAtBooking(start: Date, now: Date): boolean {
  return start.getTime() - now.getTime() > CANCELLATION_WINDOW_HOURS * 60 * MINUTE;
}

export function refundFor(
  args: { paidPence: number; currentPence: number; newPence?: number; start: Date; change: Change },
  now: Date,
): RefundDecision {
  const { paidPence, change, start } = args;

  if (change === 'cancel') {
    return refundableAtBooking(start, now)
      ? { refundPence: paidPence, chargePence: 0, reason: 'cancel' }
      : { refundPence: 0, chargePence: 0, reason: 'none' };
  }

  const newPence = args.newPence ?? args.currentPence;
  const delta = newPence - paidPence;
  if (delta > 0) return { refundPence: 0, chargePence: delta, reason: 'amend-up' };
  if (delta < 0) return { refundPence: -delta, chargePence: 0, reason: 'amend-down' };
  return { refundPence: 0, chargePence: 0, reason: 'none' };
}
