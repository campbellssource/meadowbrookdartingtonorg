// Google Sheet that backs the leaflet drop: one row per delivery zone, holding
// who's leading it, any backups, and whether it's been delivered. The sheet is
// the source of truth for *claim state*; the Google Map is still the source of
// truth for the zones themselves.
//
// Auth uses a service account via google-auth-library:
//   - Cloud Run: Application Default Credentials (the runtime service account).
//     Share the sheet with that account's email (Editor).
//   - Local dev: set GOOGLE_SERVICE_ACCOUNT_JSON to a service-account key JSON,
//     or run `gcloud auth application-default login` as the sheet owner.
//
// Concurrency note: the Sheets API isn't transactional, so two people claiming
// the same free zone within the same moment could both be recorded as lead.
// Rare for a village drop, and backups make it low-stakes - reconcile in the
// sheet.

import { GoogleAuth } from 'google-auth-library';
import type { Zone, ZoneStatus, ClaimOutcome } from './leaflet';

const TAB = 'Zones';
const HEADER = [
  'Zone',
  'Lead name',
  'Lead email',
  'Lead phone',
  'Backups',
  'Delivered',
  'Updated',
];
// Column indexes within a row.
const COL = {
  ZONE: 0,
  LEAD_NAME: 1,
  LEAD_EMAIL: 2,
  LEAD_PHONE: 3,
  BACKUPS: 4,
  DELIVERED: 5,
  UPDATED: 6,
} as const;

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export function isSheetConfigured(): boolean {
  return Boolean(process.env.LEAFLET_SHEET_ID ?? import.meta.env.LEAFLET_SHEET_ID);
}

function sheetId(): string {
  const id = process.env.LEAFLET_SHEET_ID ?? import.meta.env.LEAFLET_SHEET_ID;
  if (!id) throw new Error('LEAFLET_SHEET_ID not set');
  return id;
}

let authClient: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (authClient) return authClient;
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ??
    import.meta.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  authClient = raw
    ? new GoogleAuth({ scopes, credentials: JSON.parse(raw) })
    : new GoogleAuth({ scopes }); // ADC (Cloud Run runtime service account)
  return authClient;
}

async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getAuth().getAccessToken();
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
}

function nowStamp(): string {
  // Readable UK-ish timestamp for the organiser; sheet owner can reformat.
  return new Date().toISOString().replace('T', ' ').slice(0, 16);
}

// --- tab resolution --------------------------------------------------------

// All data lives on one tab. We prefer a tab literally named "Zones" but fall
// back to the first tab, so renaming it can't break the integration. Cached per
// instance. a1() builds a quoted A1 range that tolerates spaces/quotes.
let resolvedTab: string | null = null;
async function getTab(): Promise<string> {
  if (resolvedTab) return resolvedTab;
  const res = await authedFetch(
    `${SHEETS_BASE}/${sheetId()}?fields=sheets.properties.title`
  );
  if (!res.ok) throw new Error(`Sheet meta failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const titles: string[] = (data.sheets ?? [])
    .map((s: any) => s?.properties?.title)
    .filter(Boolean);
  resolvedTab =
    titles.find((t) => t.trim().toLowerCase() === TAB.toLowerCase()) ?? titles[0] ?? TAB;
  return resolvedTab;
}
function a1(tab: string, ref: string): string {
  return `'${tab.replace(/'/g, "''")}'!${ref}`;
}

// --- low-level sheet ops ---------------------------------------------------

async function readRows(): Promise<string[][]> {
  const range = encodeURIComponent(a1(await getTab(), 'A2:G'));
  const res = await authedFetch(`${SHEETS_BASE}/${sheetId()}/values/${range}`);
  if (!res.ok) throw new Error(`Sheet read failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.values ?? []) as string[][];
}

async function ensureHeader(): Promise<void> {
  const range = encodeURIComponent(a1(await getTab(), 'A1:G1'));
  const res = await authedFetch(`${SHEETS_BASE}/${sheetId()}/values/${range}`);
  if (!res.ok) return; // best-effort
  const data = await res.json();
  const first = (data.values?.[0] ?? []) as string[];
  if (first[0] === HEADER[0]) return;
  await authedFetch(
    `${SHEETS_BASE}/${sheetId()}/values/${range}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values: [HEADER] }) }
  );
}

// Seed zone names into column A at an explicit row. We deliberately avoid
// values.append: on a fresh sheet it places data *below* the default ~1000
// empty rows. A positioned values.update is deterministic.
async function seedZoneNames(startRow: number, names: string[]): Promise<void> {
  if (names.length === 0) return;
  const endRow = startRow + names.length - 1;
  const range = encodeURIComponent(a1(await getTab(), `A${startRow}:A${endRow}`));
  const res = await authedFetch(
    `${SHEETS_BASE}/${sheetId()}/values/${range}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', body: JSON.stringify({ values: names.map((n) => [n]) }) }
  );
  if (!res.ok) throw new Error(`Sheet seed failed: ${res.status} ${await res.text()}`);
}

async function updateCells(
  updates: { range: string; values: string[][] }[]
): Promise<void> {
  if (updates.length === 0) return;
  const res = await authedFetch(
    `${SHEETS_BASE}/${sheetId()}/values:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
    }
  );
  if (!res.ok) throw new Error(`Sheet update failed: ${res.status} ${await res.text()}`);
}

// --- helpers ---------------------------------------------------------------

function isTruthyCell(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === '✓';
}

function backupEntries(cell: string | undefined): string[] {
  if (!cell) return [];
  return cell
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function backupHasEmail(cell: string | undefined, email: string): boolean {
  const lower = email.toLowerCase();
  return backupEntries(cell).some((e) => e.toLowerCase().includes(lower));
}

interface RowRef {
  sheetRow: number; // 1-based row number in the sheet
  data: string[];
}

// Build a lookup of zone name -> row, seeding rows for any map zones that don't
// exist in the sheet yet (keeps the sheet in sync with the map).
async function loadRows(zones: Zone[]): Promise<Map<string, RowRef>> {
  const rows = await readRows();
  const byName = new Map<string, RowRef>();
  rows.forEach((data, i) => {
    const name = (data[COL.ZONE] ?? '').trim();
    if (name) byName.set(name, { sheetRow: i + 2, data });
  });

  const missing = zones.filter((z) => !byName.has(z.name));
  if (missing.length > 0) {
    await ensureHeader();
    // Write the new zones immediately after the last existing data row (row 1
    // is the header), so a fresh sheet fills from the top.
    let lastRow = 1;
    for (const ref of byName.values()) {
      if (ref.sheetRow > lastRow) lastRow = ref.sheetRow;
    }
    await seedZoneNames(lastRow + 1, missing.map((z) => z.name));
    // Re-read so we have correct row numbers for the freshly seeded rows.
    const rows2 = await readRows();
    byName.clear();
    rows2.forEach((data, i) => {
      const name = (data[COL.ZONE] ?? '').trim();
      if (name) byName.set(name, { sheetRow: i + 2, data });
    });
  }
  return byName;
}

// --- public API ------------------------------------------------------------

export async function getZoneState(zones: Zone[]): Promise<ZoneStatus[]> {
  const byName = await loadRows(zones);
  return zones.map((z) => {
    const ref = byName.get(z.name);
    const data = ref?.data ?? [];
    return {
      ...z,
      taken: Boolean((data[COL.LEAD_EMAIL] ?? '').trim()),
      backupCount: backupEntries(data[COL.BACKUPS]).length,
      delivered: isTruthyCell(data[COL.DELIVERED]),
    };
  });
}

export async function recordClaim(opts: {
  email: string;
  name: string;
  phone: string;
  zones: string[];
}): Promise<ClaimOutcome[]> {
  const email = opts.email.trim().toLowerCase();
  const byName = await loadRows(
    opts.zones.map((name) => ({ id: name, name }))
  );
  const tab = await getTab();

  const updates: { range: string; values: string[][] }[] = [];
  const outcomes: ClaimOutcome[] = [];
  const stamp = nowStamp();

  for (const zone of opts.zones) {
    const ref = byName.get(zone);
    if (!ref) continue; // shouldn't happen after loadRows seeds
    const row = ref.sheetRow;
    const leadEmail = (ref.data[COL.LEAD_EMAIL] ?? '').trim().toLowerCase();

    if (!leadEmail) {
      // Becomes lead.
      updates.push({
        range: a1(tab, `B${row}:D${row}`),
        values: [[opts.name, opts.email, opts.phone]],
      });
      updates.push({ range: a1(tab, `G${row}`), values: [[stamp]] });
      outcomes.push({ zone, role: 'primary' });
    } else if (leadEmail === email) {
      outcomes.push({ zone, role: 'primary' }); // already leading
    } else {
      // Becomes backup (skip if already listed).
      if (!backupHasEmail(ref.data[COL.BACKUPS], email)) {
        const entry = `${opts.name || 'Volunteer'} <${opts.email}>${
          opts.phone ? ` ${opts.phone}` : ''
        }`;
        const existing = (ref.data[COL.BACKUPS] ?? '').trim();
        const merged = existing ? `${existing}; ${entry}` : entry;
        updates.push({ range: a1(tab, `E${row}`), values: [[merged]] });
        updates.push({ range: a1(tab, `G${row}`), values: [[stamp]] });
      }
      outcomes.push({ zone, role: 'backup' });
    }
  }

  await updateCells(updates);
  return outcomes;
}

export async function markDelivered(opts: {
  email: string;
  zone: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = opts.email.trim().toLowerCase();
  const byName = await loadRows([{ id: opts.zone, name: opts.zone }]);
  const ref = byName.get(opts.zone);
  if (!ref) return { ok: false, error: 'Zone not found.' };

  const leadEmail = (ref.data[COL.LEAD_EMAIL] ?? '').trim().toLowerCase();
  const isLead = leadEmail === email;
  const isBackup = backupHasEmail(ref.data[COL.BACKUPS], email);
  if (!isLead && !isBackup) {
    return { ok: false, error: "We couldn't match you to this zone." };
  }

  const tab = await getTab();
  await updateCells([
    { range: a1(tab, `F${ref.sheetRow}`), values: [['TRUE']] },
    { range: a1(tab, `G${ref.sheetRow}`), values: [[nowStamp()]] },
  ]);
  return { ok: true };
}
