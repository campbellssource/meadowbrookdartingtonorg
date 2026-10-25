// Gift Aid records, as held in Firestore (spec/gift-aid/01, "Data model").
//
// Instants are `Date` here. Firestore stores a Date as a Timestamp and the store
// converts back on read, so nothing outside `store.ts` needs to know Firestore
// exists -- which is what lets the webhook path be tested against memory.

import type { Scope } from './declaration.ts';
import type { Campaign, DeclarationMethod, DonationMethod, ValidDeclaration } from './validate.ts';

/** A cell to rewrite in an already-appended row, found by the row's ID. */
export interface CellUpdate { column: string; value: string }

export interface SheetSync {
  appended: boolean;
  appendedAt: Date | null;
  attempts: number;
  lastError: string | null;
  pendingUpdates: CellUpdate[];
}

/** Queue a cell rewrite, replacing any earlier queued value for the same column. */
export function queueUpdate(s: SheetSync, u: CellUpdate): SheetSync {
  return { ...s, pendingUpdates: [...s.pendingUpdates.filter((p) => p.column !== u.column), u] };
}

export const freshSync = (): SheetSync =>
  ({ appended: false, appendedAt: null, attempts: 0, lastError: null, pendingUpdates: [] });

export interface HistoryEntry { at: Date; action: string; actor: string }

export interface Declaration {
  id: string;
  title: string | null;
  firstName: string;
  lastName: string;
  lastNameLower: string;
  houseNameOrNumber: string;
  addressLine: string;
  town: string;
  postcode: string;
  email: string | null;
  scope: Scope;
  method: DeclarationMethod;
  madeOn: string;
  madeAt: Date;
  wordingVersion: string;
  wordingText: string;
  /** 'website' for an online declaration; the signed-in committee member otherwise. */
  enteredBy: string;
  enteredAt: Date;
  confirmationSentOn: string | null;
  confirmationMethod: 'email' | 'post' | null;
  claimableFrom: string | null;
  cancelledOn: string | null;
  scanLink: string | null;
  notes: string | null;
  lastGiftOn: string | null;
  retainUntil: string;
  sheet: SheetSync;
  history: HistoryEntry[];
  isTest?: true;
}

export type DonationStatus = 'Received' | 'Refunded';

export interface Donation {
  id: string;
  declarationId: string | null;
  receivedOn: string;
  amountPence: number;
  method: DonationMethod;
  campaign: Campaign;
  source: 'Web' | 'Offline';
  viaPlatform: false;
  status: DonationStatus;
  refundedPence: number;
  squareRefundIds: string[];
  squarePaymentId: string | null;
  intentId: string | null;
  bankReference: string | null;
  notes: string | null;
  donorEmail: string | null;
  enteredBy: string;
  enteredAt: Date;
  retainUntil: string;
  sheet: SheetSync;
  history: HistoryEntry[];
  isTest?: true;
}

export interface SmallDonation {
  id: string;
  collectedOn: string;
  eventOrPlace: string;
  amountPence: number;
  kind: 'Cash' | 'Contactless';
  inBuilding: boolean;
  notes: string | null;
  enteredBy: string;
  enteredAt: Date;
  retainUntil: string;
  sheet: SheetSync;
  isTest?: true;
}

/**
 * Written by /api/donate before the card is charged. The only place a donor's
 * details sit before money has moved, and swept by TTL if it never does.
 */
export interface DonationIntent {
  id: string;
  amountPence: number;
  campaign: Campaign;
  name: string;
  email: string;
  giftAid: ValidDeclaration | null;
  wordingText: string | null;
  status: 'pending' | 'recorded';
  donationId: string | null;
  declarationId: string | null;
  createdAt: Date;
  expiresAt: Date;
  isTest?: true;
}

export type SheetKind = 'declaration' | 'donation' | 'small';
