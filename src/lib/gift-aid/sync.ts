// Sending Firestore records to the sheet, now or later.
//
// Called right after every write (best effort) and by the hourly job and the
// admin Retry button (the guarantee). Each record's outcome is written back to it,
// so a failure is visible on the admin page rather than only in a log.

import type { GiftAidStore } from './store.ts';
import type { Declaration, Donation, SmallDonation, SheetKind } from './types.ts';
import { declarationRow, donationRow, smallDonationRow } from './sheet-rows.ts';
import { syncRecord, sheetId } from './sheets.ts';
import type { SheetsApi } from './sheets.ts';

export function rowFor(kind: SheetKind, record: Declaration | Donation | SmallDonation): string[] {
  if (kind === 'declaration') return declarationRow(record as Declaration);
  if (kind === 'donation') return donationRow(record as Donation);
  return smallDonationRow(record as SmallDonation);
}

export type SyncOutcome = 'synced' | 'failed' | 'disabled' | 'missing' | 'nothing-to-do';

export async function syncOne(store: GiftAidStore, api: SheetsApi, kind: SheetKind, id: string): Promise<SyncOutcome> {
  if (!sheetId()) return 'disabled';
  const record = await store.getRecord(kind, id);
  if (!record) return 'missing';
  if (record.sheet.appended && record.sheet.pendingUpdates.length === 0) return 'nothing-to-do';
  const next = await syncRecord(api, { kind, id, row: rowFor(kind, record), sync: record.sheet });
  await store.setSync(kind, id, next);
  return next.lastError ? 'failed' : 'synced';
}

/** Never throws. A sheet problem must not fail the request that saved the record. */
export async function trySync(store: GiftAidStore, api: SheetsApi, kind: SheetKind, id: string): Promise<SyncOutcome> {
  try {
    return await syncOne(store, api, kind, id);
  } catch (err) {
    console.error('gift-aid/sync: could not sync', { kind, id, err: err instanceof Error ? err.message : String(err) });
    return 'failed';
  }
}

export interface SyncReport { synced: number; failed: number; disabled: boolean }

export async function syncPending(store: GiftAidStore, api: SheetsApi): Promise<SyncReport> {
  if (!sheetId()) return { synced: 0, failed: 0, disabled: true };
  const pending = await store.listSheetPending();
  let synced = 0;
  let failed = 0;
  // One at a time, in order: declarations before the donations that refer to them,
  // and well inside the Sheets API's per-minute quota.
  for (const { kind, id } of pending) {
    const outcome = await trySync(store, api, kind, id);
    if (outcome === 'synced') synced += 1;
    else if (outcome === 'failed') failed += 1;
  }
  return { synced, failed, disabled: false };
}
