// Appending Gift Aid records to the bookkeeper's Google Sheet.
//
// Firestore is the record of truth; this is a copy for the people who make claims.
// So the rule is that nothing here can lose a record: a failure leaves the
// Firestore document marked "not yet in the sheet", and the next sync tries again.
//
// The Sheets API has no idempotent append. A retry after "appended, then crashed
// before saying so" would add the row twice, and a duplicated donation is a
// duplicated Gift Aid claim. So every append is preceded by reading the tab's ID
// column; if the row is already there, it is not appended again.
//
// Auth: impersonation of a dedicated, role-less service account that is shared on
// this one spreadsheet and nothing else. Not a key file -- the Workspace forbids
// creating them (spec/booking/08). GIFT_AID_SHEETS_SA_JSON is honoured first in case
// one ever exists; with neither set (PR previews) the runtime identity is used.

import { GoogleAuth, Impersonated } from 'google-auth-library';
import { env } from '../booking/env.ts';
import type { SheetKind, SheetSync } from './types.ts';
import { TABS, inputRange, quoteTab, cellMatches, UPDATABLE } from './sheet-rows.ts';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/** The four calls sync needs. A seam, so sync can be tested without Google. */
export interface SheetsApi {
  /** Every value in one column of a tab, top to bottom, header included. */
  readColumn(tab: string, column: string): Promise<string[]>;
  /** Appends one row into `range`; returns the range actually written. */
  append(range: string, row: string[]): Promise<{ updatedRange: string }>;
  /** Writes one cell. */
  updateCell(a1: string, value: string): Promise<void>;
}

/** Unset means "do not sync", so dev and PR previews cannot write to the real sheet. */
export const sheetId = (): string | null => env('GIFT_AID_SHEET_ID') ?? null;

type Client = { getAccessToken(): Promise<string | null | { token?: string | null }> };
let cached: Client | null = null;

async function client(): Promise<Client> {
  if (cached) return cached;
  const inline = env('GIFT_AID_SHEETS_SA_JSON');
  if (inline) {
    cached = new GoogleAuth({ scopes: SCOPES, credentials: JSON.parse(inline) });
    return cached;
  }
  const target = env('GIFT_AID_SHEETS_IMPERSONATE_SA');
  if (!target) {
    // PR previews: the runtime identity itself is shared on the *test* copy of
    // the sheet. Production always sets the variable above (the deploy test
    // checks), so this never quietly becomes the production path.
    cached = new GoogleAuth({ scopes: SCOPES });
    return cached;
  }
  const sourceClient = await new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  }).getClient();
  cached = new Impersonated({ sourceClient, targetPrincipal: target, lifetime: 3600, delegates: [], targetScopes: SCOPES });
  return cached;
}

async function call(path: string, init: RequestInit = {}): Promise<any> {
  const raw = await (await client()).getAccessToken();
  const token = typeof raw === 'string' ? raw : raw?.token;
  if (!token) throw new Error('Could not obtain a Google access token for the Gift Aid sheet');
  const res = await fetch(`${BASE}/${sheetId()}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** The real thing. */
export const googleSheets: SheetsApi = {
  async readColumn(tab, column) {
    const range = encodeURIComponent(`${quoteTab(tab)}!${column}:${column}`);
    const data = await call(`/values/${range}?majorDimension=COLUMNS`);
    return (data.values?.[0] ?? []).map(String);
  },
  async append(range, row) {
    // OVERWRITE writes into the first empty row after the data rather than
    // inserting one. Rows are never inserted, so nothing above can move and the
    // header row's ARRAYFORMULAs are never displaced.
    const qs = new URLSearchParams({
      valueInputOption: 'USER_ENTERED', insertDataOption: 'OVERWRITE', includeValuesInResponse: 'false',
    });
    const data = await call(`/values/${encodeURIComponent(range)}:append?${qs}`, {
      method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values: [row] }),
    });
    return { updatedRange: String(data.updates?.updatedRange ?? '') };
  },
  async updateCell(a1, value) {
    const qs = new URLSearchParams({ valueInputOption: 'USER_ENTERED' });
    await call(`/values/${encodeURIComponent(a1)}?${qs}`, {
      method: 'PUT', body: JSON.stringify({ majorDimension: 'ROWS', values: [[value]] }),
    });
  },
};

/** Test seam. */
export function resetSheetsAuth(): void { cached = null; }

/**
 * `Declarations!A7:R7` -> must start at A and end at R on one row. Anything else
 * means the sheet decided the "table" was somewhere we did not intend, and a row
 * may be sitting under a formula column.
 */
export function checkUpdatedRange(kind: SheetKind, updatedRange: string): string | null {
  const t = TABS[kind];
  const m = /!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(updatedRange);
  if (!m) return `unexpected range ${updatedRange}`;
  if (m[1] !== t.firstColumn || m[3] !== t.lastColumn || m[2] !== m[4]) {
    return `wrote ${updatedRange}, expected one row ${t.firstColumn}:${t.lastColumn}`;
  }
  return null;
}

/** 1-based row number of the record in its tab, or null. */
async function findRow(api: SheetsApi, kind: SheetKind, id: string): Promise<number | null> {
  const t = TABS[kind];
  const cells = await api.readColumn(t.tab, t.idColumn);
  // Row 1 is the header; never match it.
  for (let i = 1; i < cells.length; i += 1) if (cellMatches(kind, cells[i], id)) return i + 1;
  return null;
}

export interface SyncInput {
  kind: SheetKind;
  id: string;
  row: string[];
  sync: SheetSync;
}

/**
 * Brings one record's sheet copy up to date and returns its new sync state.
 *
 * Never throws: the caller writes the returned state back to Firestore whatever
 * happened, so a failure is recorded rather than lost.
 */
export async function syncRecord(api: SheetsApi, input: SyncInput, now = new Date()): Promise<SheetSync> {
  const { kind, id, row } = input;
  const t = TABS[kind];
  let sync: SheetSync = { ...input.sync, pendingUpdates: [...input.sync.pendingUpdates] };

  if (row.length !== t.headers.length) {
    // A programming error, not a transient one: do not write a row of the wrong width.
    return { ...sync, attempts: sync.attempts + 1, lastError: `row has ${row.length} cells, tab has ${t.headers.length} input columns` };
  }

  try {
    if (!sync.appended) {
      // Check before writing: a previous attempt may have appended and then died.
      const existing = await findRow(api, kind, id);
      if (existing === null) {
        const { updatedRange } = await api.append(inputRange(kind), row);
        const problem = checkUpdatedRange(kind, updatedRange);
        if (problem) console.error('gift-aid/sheets: append landed somewhere unexpected', { kind, id, problem });
      }
      sync = { ...sync, appended: true, appendedAt: now };
    }

    if (sync.pendingUpdates.length > 0) {
      const rowNumber = await findRow(api, kind, id);
      if (rowNumber === null) throw new Error(`${id} is not in ${t.tab}; cannot update it`);
      // Rewriting a cell with the same value is harmless, so if the second of two
      // updates fails, both are simply tried again next time.
      for (const u of sync.pendingUpdates) {
        if (!UPDATABLE[kind].includes(u.column)) {
          console.error('gift-aid/sheets: refusing to write a non-updatable column', { kind, id, column: u.column });
          continue;
        }
        await api.updateCell(`${quoteTab(t.tab)}!${u.column}${rowNumber}`, u.value);
      }
      sync = { ...sync, pendingUpdates: [] };
    }

    return { ...sync, lastError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('gift-aid/sheets: sync failed', { kind, id, message });
    return { ...sync, attempts: sync.attempts + 1, lastError: message.slice(0, 300) };
  }
}
