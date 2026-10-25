// Building Gift Aid records from validated input. Pure.
//
// Every way in -- the webhook, the tablet, a paper form, a cheque -- produces its
// record here, so "who entered it and when" and the retention date cannot be
// forgotten by one door and remembered by another.

import { DECLARATION_VERSION, renderDeclaration } from './declaration.ts';
import { newDeclarationId, newDonationId, newSmallDonationId } from './ids.ts';
import { retainUntil, addDays, VERBAL_CANCEL_DAYS } from './retention.ts';
import { londonToday } from './validate.ts';
import type { ValidDeclaration, ValidOfflineDonation, ValidSmallDonation } from './validate.ts';
import type { Declaration, Donation, DonationIntent, SmallDonation } from './types.ts';
import { freshSync, queueUpdate } from './types.ts';
import type { OnlineRecords } from './store.ts';

/** Outside production every record says so, as bookings do, so test data can be found. */
const testFlag = (): { isTest?: true } => (process.env.NODE_ENV !== 'production' ? { isTest: true } : {});

export const WEBSITE_ACTOR = 'website';

export interface DeclarationContext {
  enteredBy: string;
  now: Date;
  /** For the wording only; a declaration is not a donation. */
  amountPence?: number | null;
  /** Online: the text rendered when the intent was written, which is what the donor saw. */
  wordingText?: string;
  id?: string;
}

export function buildDeclaration(v: ValidDeclaration, ctx: DeclarationContext): Declaration {
  const wordingText = ctx.wordingText ?? renderDeclaration(v.scope, ctx.amountPence ?? null);
  return {
    id: ctx.id ?? newDeclarationId(),
    title: v.title,
    firstName: v.firstName,
    lastName: v.lastName,
    lastNameLower: v.lastName.toLowerCase(),
    houseNameOrNumber: v.houseNameOrNumber,
    addressLine: v.addressLine,
    town: v.town,
    postcode: v.postcode,
    email: v.email,
    scope: v.scope,
    method: v.method,
    madeOn: v.madeOn,
    madeAt: ctx.now,
    wordingVersion: DECLARATION_VERSION,
    wordingText,
    enteredBy: ctx.enteredBy,
    enteredAt: ctx.now,
    confirmationSentOn: null,
    confirmationMethod: null,
    claimableFrom: null,
    cancelledOn: null,
    scanLink: v.scanLink,
    notes: v.notes,
    lastGiftOn: null,
    retainUntil: retainUntil(v.madeOn),
    sheet: freshSync(),
    history: [{ at: ctx.now, action: `declared (${v.method}, ${v.scope})`, actor: ctx.enteredBy }],
    ...testFlag(),
  };
}

export interface CompletedPayment {
  id: string;
  amountPence: number;
  /** When Square says it completed. */
  at: Date;
}

/** What a paid intent becomes, inside the recording transaction. */
export function buildOnlineRecords(intent: DonationIntent, payment: CompletedPayment, now: Date): OnlineRecords {
  const receivedOn = londonToday(payment.at);
  const declaration = intent.giftAid
    ? buildDeclaration(intent.giftAid, {
      enteredBy: WEBSITE_ACTOR, now, wordingText: intent.wordingText ?? undefined,
    })
    : null;
  if (declaration) {
    declaration.lastGiftOn = receivedOn;
    declaration.retainUntil = retainUntil(receivedOn);
  }
  // Square's amount, not the intent's: it is what was actually taken.
  if (payment.amountPence !== intent.amountPence) {
    console.warn('gift-aid: paid amount differs from intent', { intent: intent.id, intended: intent.amountPence, paid: payment.amountPence });
  }
  const donation: Donation = {
    id: newDonationId(),
    declarationId: declaration?.id ?? null,
    receivedOn,
    amountPence: payment.amountPence,
    method: 'Online',
    campaign: intent.campaign,
    source: 'Web',
    viaPlatform: false,
    status: 'Received',
    refundedPence: 0,
    squareRefundIds: [],
    squarePaymentId: payment.id,
    intentId: intent.id,
    bankReference: null,
    notes: null,
    donorEmail: intent.email,
    enteredBy: WEBSITE_ACTOR,
    enteredAt: now,
    retainUntil: retainUntil(receivedOn),
    sheet: freshSync(),
    history: [{ at: now, action: 'received (Square payment completed)', actor: 'square' }],
    ...testFlag(),
  };
  return { declaration, donation };
}

export function buildOfflineDonation(v: ValidOfflineDonation, enteredBy: string, now: Date, donorEmail: string | null): Donation {
  return {
    id: newDonationId(),
    declarationId: v.declarationId,
    receivedOn: v.receivedOn,
    amountPence: v.amountPence,
    method: v.method,
    campaign: v.campaign,
    source: 'Offline',
    viaPlatform: false,
    status: 'Received',
    refundedPence: 0,
    squareRefundIds: [],
    squarePaymentId: null,
    intentId: null,
    bankReference: v.bankReference,
    notes: v.notes,
    donorEmail,
    enteredBy,
    enteredAt: now,
    retainUntil: retainUntil(v.receivedOn),
    sheet: freshSync(),
    history: [{ at: now, action: `received (${v.method})`, actor: enteredBy }],
    ...testFlag(),
  };
}

export function buildSmallDonation(v: ValidSmallDonation, enteredBy: string, now: Date): SmallDonation {
  return {
    id: newSmallDonationId(),
    ...v,
    enteredBy,
    enteredAt: now,
    retainUntil: retainUntil(v.collectedOn),
    sheet: freshSync(),
    ...testFlag(),
  };
}

/** Recording that the written confirmation of a verbal declaration went out. */
export function confirmationPatch(
  d: Declaration, sentOn: string, how: 'email' | 'post', actor: string, now: Date,
): Partial<Declaration> | null {
  if (d.method !== 'Verbal' || d.confirmationSentOn) return null;
  return {
    confirmationSentOn: sentOn,
    confirmationMethod: how,
    claimableFrom: addDays(sentOn, VERBAL_CANCEL_DAYS),
    sheet: queueUpdate(d.sheet, { column: 'N', value: sentOn }),
    history: [...d.history, { at: now, action: `written confirmation sent (${how})`, actor }],
  };
}

export function cancellationPatch(d: Declaration, cancelledOn: string, actor: string, now: Date): Partial<Declaration> | null {
  if (d.cancelledOn) return null;
  return {
    cancelledOn,
    sheet: queueUpdate(d.sheet, { column: 'O', value: cancelledOn }),
    history: [...d.history, { at: now, action: 'cancelled', actor }],
  };
}

/** Whether a declaration can back a claim today. Mirrors the sheet's Status column, plus the verbal 30 days. */
export function claimable(d: Declaration, today: string): boolean {
  if (d.cancelledOn) return false;
  if (d.method !== 'Verbal') return true;
  return Boolean(d.claimableFrom && d.claimableFrom <= today);
}
