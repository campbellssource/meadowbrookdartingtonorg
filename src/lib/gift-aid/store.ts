// Firestore access for Gift Aid.
//
// Same database and identity as bookings (`booking-app` on meadowbrook-booking),
// reached through the booking store's `getDb()` so there is one impersonation path.
//
// Everything that must not happen twice -- recording a paid donation, applying a
// refund -- is a transaction that reads the record's state first. That, not
// remembering webhook event ids, is what makes Square's retries harmless: a second
// delivery reads "already recorded" and does nothing, whichever event type it is.
//
// The interface exists so the webhook path can be tested against memory
// (`memoryStore` in the tests) with the same semantics.

import { Timestamp } from '@google-cloud/firestore';
import { getDb } from '../booking/store.ts';
import type { Declaration, Donation, DonationIntent, SmallDonation, SheetKind, SheetSync } from './types.ts';
import { queueUpdate } from './types.ts';
import { retainUntil } from './retention.ts';

export interface OnlineRecords { declaration: Declaration | null; donation: Donation }

export type RecordOutcome =
  | { outcome: 'created'; intent: DonationIntent; records: OnlineRecords }
  | { outcome: 'duplicate'; intent: DonationIntent }
  | { outcome: 'unknown-intent' };

export type RefundOutcome =
  | { outcome: 'updated'; donation: Donation }
  | { outcome: 'duplicate' };

type Patch<T> = Partial<T>;

export interface GiftAidStore {
  createIntent(intent: DonationIntent): Promise<void>;
  /** `build` runs inside the transaction, only if the intent is still pending. */
  recordOnlineDonation(intentId: string, build: (intent: DonationIntent) => OnlineRecords): Promise<RecordOutcome>;
  findDonationByPaymentId(squarePaymentId: string): Promise<Donation | null>;
  applyRefund(donationId: string, squareRefundId: string, refundPence: number, now: Date): Promise<RefundOutcome>;

  createDeclaration(d: Declaration): Promise<void>;
  /** Also moves the declaration's last gift date and retention forward. */
  createDonation(d: Donation): Promise<void>;
  createSmallDonation(s: SmallDonation): Promise<void>;
  getDeclaration(id: string): Promise<Declaration | null>;
  findDeclarations(lastName: string, postcode: string): Promise<Declaration[]>;
  /** Transactional read-modify-write. `change` returning null means "no change". */
  updateDeclaration(id: string, change: (d: Declaration) => Patch<Declaration> | null): Promise<Declaration | null>;
  listAwaitingConfirmation(): Promise<Declaration[]>;

  getRecord(kind: SheetKind, id: string): Promise<Declaration | Donation | SmallDonation | null>;
  listSheetPending(limit?: number): Promise<{ kind: SheetKind; id: string }[]>;
  setSync(kind: SheetKind, id: string, sync: SheetSync): Promise<void>;
}

/** Whether a record still has something to send to the sheet. Stored, so it can be queried. */
export const sheetPending = (s: SheetSync): boolean => !s.appended || s.pendingUpdates.length > 0;

/** The declaration fields that change when a gift is recorded against it. */
export function lastGiftPatch(d: Declaration, giftOn: string): Patch<Declaration> | null {
  if (d.lastGiftOn && d.lastGiftOn >= giftOn) return null;
  return { lastGiftOn: giftOn, retainUntil: retainUntil(giftOn) };
}

const COLLECTION: Record<SheetKind | 'intent', string> = {
  declaration: 'giftAidDeclarations',
  donation: 'donations',
  small: 'smallDonations',
  intent: 'donationIntents',
};

/** Firestore returns Timestamps; everything outside this file sees Dates. */
function revive<T>(value: unknown): T {
  if (value instanceof Timestamp) return value.toDate() as T;
  if (Array.isArray(value)) return value.map((v) => revive(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = revive(v);
    return out as T;
  }
  return value as T;
}

/** What is written: the record, plus the queryable sync flag. */
const withFlag = <T extends { sheet: SheetSync }>(r: T) => ({ ...r, sheetPending: sheetPending(r.sheet) });

export const firestoreStore: GiftAidStore = {
  async createIntent(intent) {
    const db = await getDb();
    await db.collection(COLLECTION.intent).doc(intent.id).create(intent);
  },

  async recordOnlineDonation(intentId, build) {
    const db = await getDb();
    const intentRef = db.collection(COLLECTION.intent).doc(intentId);
    return db.runTransaction(async (tx): Promise<RecordOutcome> => {
      const snap = await tx.get(intentRef);
      if (!snap.exists) return { outcome: 'unknown-intent' };
      const intent = revive<DonationIntent>(snap.data());
      if (intent.status === 'recorded') return { outcome: 'duplicate', intent };

      const records = build(intent);
      if (records.declaration) {
        tx.create(db.collection(COLLECTION.declaration).doc(records.declaration.id), withFlag(records.declaration));
      }
      tx.create(db.collection(COLLECTION.donation).doc(records.donation.id), withFlag(records.donation));
      tx.update(intentRef, {
        status: 'recorded',
        donationId: records.donation.id,
        declarationId: records.declaration?.id ?? null,
        // A recorded intent has done its job; the TTL can take it soon.
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      });
      return { outcome: 'created', intent, records };
    });
  },

  async findDonationByPaymentId(squarePaymentId) {
    const db = await getDb();
    const snap = await db.collection(COLLECTION.donation).where('squarePaymentId', '==', squarePaymentId).limit(1).get();
    return snap.empty ? null : revive<Donation>(snap.docs[0].data());
  },

  async applyRefund(donationId, squareRefundId, refundPence, now) {
    const db = await getDb();
    const ref = db.collection(COLLECTION.donation).doc(donationId);
    return db.runTransaction(async (tx): Promise<RefundOutcome> => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { outcome: 'duplicate' };
      const d = revive<Donation>(snap.data());
      const next = applyRefundTo(d, squareRefundId, refundPence, now);
      if (!next) return { outcome: 'duplicate' };
      tx.set(ref, withFlag(next));
      return { outcome: 'updated', donation: next };
    });
  },

  async createDeclaration(d) {
    const db = await getDb();
    await db.collection(COLLECTION.declaration).doc(d.id).create(withFlag(d));
  },

  async createDonation(d) {
    const db = await getDb();
    await db.runTransaction(async (tx) => {
      const declRef = d.declarationId ? db.collection(COLLECTION.declaration).doc(d.declarationId) : null;
      const declSnap = declRef ? await tx.get(declRef) : null;
      tx.create(db.collection(COLLECTION.donation).doc(d.id), withFlag(d));
      if (declRef && declSnap?.exists) {
        const patch = lastGiftPatch(revive<Declaration>(declSnap.data()), d.receivedOn);
        if (patch) tx.update(declRef, patch);
      }
    });
  },

  async createSmallDonation(s) {
    const db = await getDb();
    await db.collection(COLLECTION.small).doc(s.id).create(withFlag(s));
  },

  async getDeclaration(id) {
    const db = await getDb();
    const snap = await db.collection(COLLECTION.declaration).doc(id).get();
    return snap.exists ? revive<Declaration>(snap.data()) : null;
  },

  async findDeclarations(lastName, postcode) {
    const db = await getDb();
    // Equality on postcode only, then the name in memory: no composite index, and
    // a postcode holds a handful of households.
    const snap = await db.collection(COLLECTION.declaration).where('postcode', '==', postcode).get();
    const needle = lastName.trim().toLowerCase();
    return snap.docs.map((doc) => revive<Declaration>(doc.data()))
      .filter((d) => !needle || d.lastNameLower.includes(needle));
  },

  async updateDeclaration(id, change) {
    const db = await getDb();
    const ref = db.collection(COLLECTION.declaration).doc(id);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const d = revive<Declaration>(snap.data());
      const patch = change(d);
      if (!patch) return d;
      const next = { ...d, ...patch };
      tx.set(ref, withFlag(next));
      return next;
    });
  },

  async listAwaitingConfirmation() {
    const db = await getDb();
    const snap = await db.collection(COLLECTION.declaration)
      .where('method', '==', 'Verbal').where('confirmationSentOn', '==', null).get();
    return snap.docs.map((doc) => revive<Declaration>(doc.data())).filter((d) => !d.cancelledOn);
  },

  async getRecord(kind, id) {
    const db = await getDb();
    const snap = await db.collection(COLLECTION[kind]).doc(id).get();
    return snap.exists ? revive(snap.data()) : null;
  },

  async listSheetPending(limit = 50) {
    const db = await getDb();
    const out: { kind: SheetKind; id: string }[] = [];
    // Declarations first: a donation row looks its declaration up by ID, so it
    // reads correctly sooner if the declaration is already there.
    for (const kind of ['declaration', 'donation', 'small'] as SheetKind[]) {
      const snap = await db.collection(COLLECTION[kind]).where('sheetPending', '==', true).limit(limit).get();
      for (const doc of snap.docs) out.push({ kind, id: doc.id });
    }
    return out;
  },

  async setSync(kind, id, sync) {
    const db = await getDb();
    await db.collection(COLLECTION[kind]).doc(id).update({ sheet: sync, sheetPending: sheetPending(sync) });
  },
};

/**
 * A donation after a completed refund, or null if this refund is already applied.
 *
 * Any completed refund -- partial included -- marks the gift Refunded. The sheet
 * knows only Received/Refunded, and claiming Gift Aid on money that went back is
 * the expensive mistake. The refunded amount is kept so the treasurer can re-enter
 * the net gift if they want it claimed.
 */
export function applyRefundTo(d: Donation, squareRefundId: string, refundPence: number, now: Date): Donation | null {
  if (d.squareRefundIds.includes(squareRefundId)) return null;
  const refundedPence = d.refundedPence + refundPence;
  const partial = refundedPence < d.amountPence;
  const sheet = d.status === 'Refunded' ? d.sheet : queueUpdate(d.sheet, { column: 'I', value: 'Refunded' });
  return {
    ...d,
    status: 'Refunded',
    refundedPence,
    squareRefundIds: [...d.squareRefundIds, squareRefundId],
    sheet,
    history: [...d.history, {
      at: now, actor: 'square',
      action: partial ? `partial refund ${refundPence}p (marked Refunded)` : `refunded ${refundPence}p`,
    }],
  };
}
