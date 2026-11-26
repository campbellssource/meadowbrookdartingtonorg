// An in-memory GiftAidStore with the Firestore store's semantics, for tests.
//
// Not a test file itself (the runner only picks up *.test.ts). The transactional
// behaviour that matters -- "recording a paid intent happens once" -- is reproduced
// exactly: check state, build, write, mark recorded, as one step.

import type { GiftAidStore, OnlineRecords, RecordOutcome, RefundOutcome } from '../src/lib/gift-aid/store.ts';
import { applyRefundTo, lastGiftPatch } from '../src/lib/gift-aid/store.ts';
import type { Declaration, Donation, DonationIntent, SmallDonation, SheetKind, SheetSync } from '../src/lib/gift-aid/types.ts';

const clone = <T>(v: T): T => structuredClone(v);

export function memoryStore() {
  const intents = new Map<string, DonationIntent>();
  const declarations = new Map<string, Declaration>();
  const donations = new Map<string, Donation>();
  const small = new Map<string, SmallDonation>();
  const maps = { declaration: declarations, donation: donations, small } as Record<SheetKind, Map<string, any>>;

  const store: GiftAidStore = {
    async createIntent(intent) {
      if (intents.has(intent.id)) throw new Error('exists');
      intents.set(intent.id, clone(intent));
    },
    async recordOnlineDonation(intentId, build: (i: DonationIntent) => OnlineRecords): Promise<RecordOutcome> {
      const intent = intents.get(intentId);
      if (!intent) return { outcome: 'unknown-intent' };
      if (intent.status === 'recorded') return { outcome: 'duplicate', intent: clone(intent) };
      const records = build(clone(intent));
      if (records.declaration) declarations.set(records.declaration.id, clone(records.declaration));
      donations.set(records.donation.id, clone(records.donation));
      intents.set(intentId, { ...intent, status: 'recorded', donationId: records.donation.id, declarationId: records.declaration?.id ?? null });
      return { outcome: 'created', intent: clone(intent), records };
    },
    async findDonationByPaymentId(id) {
      for (const d of donations.values()) if (d.squarePaymentId === id) return clone(d);
      return null;
    },
    async applyRefund(donationId, refundId, pence, now): Promise<RefundOutcome> {
      const d = donations.get(donationId);
      if (!d) return { outcome: 'duplicate' };
      const next = applyRefundTo(d, refundId, pence, now);
      if (!next) return { outcome: 'duplicate' };
      donations.set(donationId, clone(next));
      return { outcome: 'updated', donation: clone(next) };
    },
    async createDeclaration(d) { declarations.set(d.id, clone(d)); },
    async createDonation(d) {
      donations.set(d.id, clone(d));
      const decl = d.declarationId ? declarations.get(d.declarationId) : undefined;
      if (decl) {
        const patch = lastGiftPatch(decl, d.receivedOn);
        if (patch) declarations.set(decl.id, { ...decl, ...patch });
      }
    },
    async createSmallDonation(s) { small.set(s.id, clone(s)); },
    async getDeclaration(id) { const d = declarations.get(id); return d ? clone(d) : null; },
    async findDeclarations(lastName, postcode) {
      return [...declarations.values()].filter((d) => d.postcode === postcode && d.lastNameLower.includes(lastName.toLowerCase())).map(clone);
    },
    async updateDeclaration(id, change) {
      const d = declarations.get(id);
      if (!d) return null;
      const patch = change(clone(d));
      if (!patch) return clone(d);
      const next = { ...d, ...patch };
      declarations.set(id, next);
      return clone(next);
    },
    async listAwaitingConfirmation() {
      return [...declarations.values()].filter((d) => d.method === 'Verbal' && !d.confirmationSentOn && !d.cancelledOn).map(clone);
    },
    async getRecord(kind, id) { const r = maps[kind].get(id); return r ? clone(r) : null; },
    async listSheetPending() {
      const out: { kind: SheetKind; id: string }[] = [];
      for (const kind of ['declaration', 'donation', 'small'] as SheetKind[]) {
        for (const [id, r] of maps[kind]) if (!r.sheet.appended || r.sheet.pendingUpdates.length) out.push({ kind, id });
      }
      return out;
    },
    async setSync(kind, id, sync: SheetSync) {
      const r = maps[kind].get(id);
      if (r) maps[kind].set(id, { ...r, sheet: clone(sync) });
    },
  };
  return { store, intents, declarations, donations, small };
}
