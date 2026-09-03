// Square: charges and refunds for room bookings.
//
// Booking gets its own credentials, separate from `/donate`'s live ones, so a
// sandbox booking can never touch real money and a mistake in one cannot reach
// the other.
//
// The client-side half matters more than this file. `/donate` needed significant
// work after going live -- 3-D Secure flows the sandbox barely exercised, Visa
// failing where Mastercard worked -- so the tokenize call in the booking widget is
// copied from the corrected version rather than written afresh. See
// spec/booking/04-payments-and-refunds.md.

import { randomUUID } from 'node:crypto';
import { env } from './env.ts';

const API_VERSION = '2024-01-17';

export interface SquareConfig {
  accessToken: string;
  locationId: string;
  environment: 'sandbox' | 'production';
}

export function squareConfig(): SquareConfig | null {
  const accessToken = env('BOOKING_SQUARE_ACCESS_TOKEN');
  const locationId = env('PUBLIC_BOOKING_SQUARE_LOCATION_ID');
  const environment = (env('PUBLIC_BOOKING_SQUARE_ENVIRONMENT') ?? 'sandbox') as SquareConfig['environment'];
  if (!accessToken || !locationId) return null;
  return { accessToken, locationId, environment };
}

const baseUrl = (env: string): string =>
  env === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';

export interface SquareError {
  code?: string;
  category?: string;
  detail?: string;
}

export class PaymentError extends Error {
  code: string | undefined;
  category: string | undefined;
  httpStatus: number;

  constructor(message: string, opts: { code?: string; category?: string; httpStatus: number }) {
    super(message);
    this.name = 'PaymentError';
    this.code = opts.code;
    this.category = opts.category;
    this.httpStatus = opts.httpStatus;
  }
}

/**
 * Turns a Square failure into something a hirer can act on.
 *
 * `CARD_DECLINED_VERIFICATION_REQUIRED` gets the clearer wording `/donate` already
 * uses: it means the bank wants to verify, not that the card is bad, and the raw
 * Square string does not say so.
 */
export function friendlyMessage(err: SquareError | undefined): string {
  if (err?.code === 'CARD_DECLINED_VERIFICATION_REQUIRED') {
    return 'Your bank needs to verify this payment. Please try again and complete the '
      + 'verification step, or use a different card.';
  }
  if (err?.code === 'INSUFFICIENT_FUNDS') return 'That card was declined for insufficient funds.';
  if (err?.code === 'CVV_FAILURE') return 'The security code did not match. Please check and try again.';
  if (err?.code === 'GENERIC_DECLINE') return 'That card was declined. Please try another card.';
  return err?.detail ?? 'Payment failed. Please try again.';
}

async function call(
  cfg: SquareConfig, path: string, body: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, any> }> {
  const res = await fetch(`${baseUrl(cfg.environment)}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': API_VERSION,
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

export interface ChargeInput {
  sourceId: string;
  amountPence: number;
  /**
   * Deterministic, and derived from the hold rather than random.
   *
   * A retried request -- the booker double-clicking, a proxy replaying, our own
   * retry after a timeout -- reuses the key, and Square returns the original
   * payment instead of taking the money twice.
   */
  idempotencyKey: string;
  bookingRef: string;
  roomName: string;
  buyerEmail?: string;
  note?: string;
}

export interface ChargeResult {
  squarePaymentId: string;
  amountPence: number;
  status: 'completed' | 'pending';
}

export async function charge(cfg: SquareConfig, input: ChargeInput): Promise<ChargeResult> {
  const { ok, status, data } = await call(cfg, '/v2/payments', {
    // Strong Customer Authentication rides on the token: the client runs it via
    // tokenize(verificationDetails), so no separate verification token here.
    source_id: input.sourceId,
    idempotency_key: input.idempotencyKey,
    amount_money: { amount: input.amountPence, currency: 'GBP' },
    location_id: cfg.locationId,
    ...(input.buyerEmail ? { buyer_email_address: input.buyerEmail } : {}),
    reference_id: input.bookingRef,
    note: input.note ?? `Meadowbrook room booking — ${input.roomName} — ${input.bookingRef}`,
  });

  const payment = data.payment;
  if (ok && (payment?.status === 'COMPLETED' || payment?.status === 'APPROVED')) {
    return {
      squarePaymentId: payment.id,
      amountPence: payment.amount_money?.amount ?? input.amountPence,
      status: payment.status === 'COMPLETED' ? 'completed' : 'pending',
    };
  }

  const err: SquareError | undefined = data.errors?.[0];
  // Non-identifying fields only: never the token, never a PAN.
  console.error('booking/square: payment not completed', {
    httpStatus: status, amountPence: input.amountPence, bookingRef: input.bookingRef,
    code: err?.code, category: err?.category, detail: err?.detail,
  });
  throw new PaymentError(friendlyMessage(err), {
    code: err?.code, category: err?.category, httpStatus: ok ? 502 : status,
  });
}

export interface RefundInput {
  squarePaymentId: string;
  amountPence: number;
  /** `<bookingRef>:<historyIndex>` — deterministic, so a replay cannot refund twice. */
  idempotencyKey: string;
  reason: string;
}

export interface RefundResult { squareRefundId: string; status: 'completed' | 'pending' }

export async function refund(cfg: SquareConfig, input: RefundInput): Promise<RefundResult> {
  const { ok, status, data } = await call(cfg, '/v2/refunds', {
    idempotency_key: input.idempotencyKey,
    payment_id: input.squarePaymentId,
    amount_money: { amount: input.amountPence, currency: 'GBP' },
    reason: input.reason,
  });

  const r = data.refund;
  if (ok && (r?.status === 'COMPLETED' || r?.status === 'PENDING')) {
    return { squareRefundId: r.id, status: r.status === 'COMPLETED' ? 'completed' : 'pending' };
  }

  const err: SquareError | undefined = data.errors?.[0];
  console.error('booking/square: refund failed', {
    httpStatus: status, amountPence: input.amountPence,
    code: err?.code, category: err?.category, detail: err?.detail,
  });
  throw new PaymentError(err?.detail ?? 'Refund failed.', {
    code: err?.code, category: err?.category, httpStatus: ok ? 502 : status,
  });
}

/** Random key for the rare case where there is nothing deterministic to derive one from. */
export const randomIdempotencyKey = (): string => randomUUID();
