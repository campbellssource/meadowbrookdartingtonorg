// Turning a Square notification into a donation record.
//
// The rules, from spec/gift-aid/01:
//
//   - Only a payment Square reports COMPLETED records anything, and that status is
//     read back from Square's API, never taken from the webhook body.
//   - Only payments this site started as donations count. A subscription sees every
//     payment on the account -- room bookings, the card reader, the raffle -- and a
//     payment we did not create a DI- intent for is none of this code's business.
//   - Duplicates are harmless because recording is a state check in a transaction,
//     not because event ids are remembered.
//
// Dependencies are passed in, so the whole path runs in tests against memory.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIntentId } from './ids.ts';
import { buildOnlineRecords } from './records.ts';
import type { GiftAidStore, OnlineRecords } from './store.ts';
import type { Donation, DonationIntent } from './types.ts';

export interface SquarePayment {
  id: string;
  status: string;
  reference_id?: string;
  amount_money?: { amount?: number };
  updated_at?: string;
  created_at?: string;
}

export interface SquareRefund {
  id: string;
  status: string;
  payment_id?: string;
  amount_money?: { amount?: number };
}

export interface WebhookDeps {
  store: GiftAidStore;
  getPayment(id: string): Promise<SquarePayment | null>;
  getRefund(id: string): Promise<SquareRefund | null>;
  /** Runs after a new donation is committed: email and sheet. Must not throw. */
  afterRecorded(records: OnlineRecords, intent: DonationIntent): Promise<void>;
  /** Runs after a refund is applied: sheet and an alert. Must not throw. */
  afterRefunded(donation: Donation, refundPence: number): Promise<void>;
  now?: () => Date;
}

export type WebhookResult =
  | 'recorded' | 'duplicate' | 'refunded' | 'refund-duplicate'
  | 'ignored' | 'not-completed' | 'unknown-intent' | 'not-found';

interface SquareEvent {
  type?: string;
  data?: { object?: { payment?: { id?: string }; refund?: { id?: string } } };
}

export async function processDonationEvent(event: SquareEvent, deps: WebhookDeps): Promise<WebhookResult> {
  const now = deps.now ?? (() => new Date());
  const type = String(event.type ?? '');
  const object = event.data?.object ?? {};

  if (type.startsWith('payment.')) {
    const id = object.payment?.id;
    if (!id) return 'ignored';
    const payment = await deps.getPayment(id);
    if (!payment) return 'not-found';
    if (!isIntentId(payment.reference_id)) return 'ignored';
    if (payment.status !== 'COMPLETED') return 'not-completed';

    const amountPence = Number(payment.amount_money?.amount);
    if (!Number.isInteger(amountPence) || amountPence <= 0) return 'ignored';
    const at = new Date(payment.updated_at ?? payment.created_at ?? now().toISOString());

    const result = await deps.store.recordOnlineDonation(payment.reference_id, (intent) =>
      buildOnlineRecords(intent, { id: payment.id, amountPence, at }, now()));

    if (result.outcome === 'unknown-intent') return 'unknown-intent';
    if (result.outcome === 'duplicate') return 'duplicate';
    await deps.afterRecorded(result.records, result.intent);
    return 'recorded';
  }

  if (type.startsWith('refund.')) {
    const id = object.refund?.id;
    if (!id) return 'ignored';
    const refund = await deps.getRefund(id);
    if (!refund) return 'not-found';
    // PENDING refunds are not money returned yet; Square sends refund.updated when it is.
    if (refund.status !== 'COMPLETED') return 'not-completed';
    if (!refund.payment_id) return 'ignored';

    const donation = await deps.store.findDonationByPaymentId(refund.payment_id);
    if (!donation) return 'ignored';
    const refundPence = Number(refund.amount_money?.amount ?? 0);
    const result = await deps.store.applyRefund(donation.id, refund.id, refundPence, now());
    if (result.outcome === 'duplicate') return 'refund-duplicate';
    await deps.afterRefunded(result.donation, refundPence);
    return 'refunded';
  }

  return 'ignored';
}

/** Square signs the notification URL concatenated with the raw body. */
export function verifySquareSignature(
  key: string | undefined, notificationUrl: string, rawBody: string, signature: string | null,
): boolean {
  if (!key || !signature) return false;
  const expected = createHmac('sha256', key).update(notificationUrl + rawBody).digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
