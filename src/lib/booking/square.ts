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
  /**
   * The fallback location: any room not in `locationIds`, and every payment
   * recorded before per-room locations existed (`18`).
   */
  locationId: string;
  /** Facility slug → Square location id, from `BOOKING_SQUARE_LOCATION_IDS`. */
  locationIds: Record<string, string>;
  environment: 'sandbox' | 'production';
}

export function squareConfig(): SquareConfig | null {
  const accessToken = env('BOOKING_SQUARE_ACCESS_TOKEN');
  const locationId = env('PUBLIC_BOOKING_SQUARE_LOCATION_ID');
  const environment = (env('PUBLIC_BOOKING_SQUARE_ENVIRONMENT') ?? 'sandbox') as SquareConfig['environment'];
  if (!accessToken || !locationId) return null;
  return { accessToken, locationId, locationIds: parseLocationMap(env('BOOKING_SQUARE_LOCATION_IDS')), environment };
}

// ── Locations per room (spec/booking/18-square-locations.md) ─────────────────
//
// Square pays out per location, so each room charges against its own location
// and the bookkeeper sees the income split without asking. The ids live in env,
// not Keystatic content, because sandbox and production ids differ.
//
// The one failure that matters: the card form is tokenised against a location in
// the browser, and the charge names a location on the server. Both sides resolve
// through `bookingLocationFor`, so they cannot disagree.

const LOCATION_ID = /^[A-Z0-9]{8,32}$/;

/**
 * `BOOKING_SQUARE_LOCATION_IDS` as a map. Never throws: a bad value means every
 * room falls back to the single location, which is how bookings worked before --
 * a mis-set env var must not take payments down.
 */
export function parseLocationMap(raw: string | undefined): Record<string, string> {
  if (!raw || !raw.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    console.warn('booking/square: BOOKING_SQUARE_LOCATION_IDS is not valid JSON; using the fallback location');
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn('booking/square: BOOKING_SQUARE_LOCATION_IDS is not an object; using the fallback location');
    return {};
  }
  const out: Record<string, string> = {};
  for (const [slug, id] of Object.entries(parsed)) {
    if (typeof id === 'string' && LOCATION_ID.test(id)) out[slug] = id;
    else console.warn('booking/square: ignoring bad location id', { slug });
  }
  return out;
}

/** The Square location a room's payments go to. */
export function squareLocationFor(cfg: Pick<SquareConfig, 'locationId' | 'locationIds'>, roomSlug: string): string {
  return cfg.locationIds[roomSlug] ?? cfg.locationId;
}

/** Both halves of the location config, for reporting. No access token needed. */
export function bookingLocations(): { fallback: string; bySlug: Record<string, string> } {
  return {
    fallback: env('PUBLIC_BOOKING_SQUARE_LOCATION_ID') ?? 'unknown',
    bySlug: parseLocationMap(env('BOOKING_SQUARE_LOCATION_IDS')),
  };
}

/**
 * A location id as the bookkeeper knows it: the rooms that pay into it, or "Main"
 * for the fallback. The id goes alongside so it can be matched to Square.
 */
export function locationLabel(
  id: string, locs: { fallback: string; bySlug: Record<string, string> },
  roomName: (slug: string) => string = (s) => s,
): string {
  if (id === 'acuity') return 'Acuity (imported)';
  const rooms = Object.entries(locs.bySlug).filter(([, v]) => v === id).map(([slug]) => roomName(slug));
  const name = rooms.length ? rooms.join(' + ') : id === locs.fallback ? 'Main' : 'Other';
  return `${name} (${id})`;
}

/**
 * The same resolution from env alone, for pages initialising the card form.
 * Needs no access token, so it works wherever the public ids are readable.
 */
export function bookingLocationFor(roomSlug: string): string | undefined {
  const fallback = env('PUBLIC_BOOKING_SQUARE_LOCATION_ID');
  return parseLocationMap(env('BOOKING_SQUARE_LOCATION_IDS'))[roomSlug] ?? fallback;
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
  /** Picks the Square location. Must match the location the card was tokenised against. */
  roomSlug: string;
  buyerEmail?: string;
  note?: string;
}

export interface ChargeResult {
  squarePaymentId: string;
  amountPence: number;
  status: 'completed' | 'pending';
  /** Where the money went, for the ledger. */
  squareLocationId: string;
}

export async function charge(cfg: SquareConfig, input: ChargeInput): Promise<ChargeResult> {
  const locationId = squareLocationFor(cfg, input.roomSlug);
  const { ok, status, data } = await call(cfg, '/v2/payments', {
    // Strong Customer Authentication rides on the token: the client runs it via
    // tokenize(verificationDetails), so no separate verification token here.
    source_id: input.sourceId,
    idempotency_key: input.idempotencyKey,
    amount_money: { amount: input.amountPence, currency: 'GBP' },
    location_id: locationId,
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
      squareLocationId: payment.location_id ?? locationId,
    };
  }

  const err: SquareError | undefined = data.errors?.[0];
  // Non-identifying fields only: never the token, never a PAN.
  console.error('booking/square: payment not completed', {
    httpStatus: status, amountPence: input.amountPence, bookingRef: input.bookingRef, locationId,
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

// Refunds name the payment, not a location: Square returns the money from
// whichever location the payment was taken at, so a refund always follows the
// original charge (`18`).
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
