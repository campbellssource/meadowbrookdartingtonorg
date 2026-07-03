// Google Sheets that back the Extravaganza raffle. Two spreadsheets:
//
//   Prizes sheet (RAFFLE_PRIZES_SHEET_ID) — safe to share with organisers:
//     Prizes   — hand-editable list of prizes (incl. the `star` headline prize)
//     Settings — key/value config (e.g. entry_deadline)
//
//   Main sheet (RAFFLE_SHEET_ID) — holds entrant PII, keep access tight:
//     Payments — one row per attempt; entrant + consent + Square idempotency key
//     Entries  — the ticket pool (one row per ticket), denormalised with entrant
//                details so the draw / public list / winner contact need no joins
//     Draws    — one row per prize once drawn (audit: method, pool size, who, when)
//
// Splitting them lets a prize editor manage prizes without seeing entrant data.
// If RAFFLE_PRIZES_SHEET_ID is unset, all tabs fall back to the one main sheet.
//
// Auth uses a service account via google-auth-library, like the leaflet drop
// (see ./leaflet-sheet.ts), with one extra path for this managed Google domain
// (which blocks both the Sheets OAuth scope on user consent AND service-account
// key downloads). Resolution order:
//   1. GOOGLE_SERVICE_ACCOUNT_JSON — a service-account key (if ever allowed).
//   2. RAFFLE_IMPERSONATE_SA set — impersonate that service account using the
//      ambient ADC (the local `gcloud` login), minting short-lived Sheets-scoped
//      tokens via the IAM Credentials API. Local-dev workaround; the sheet must
//      be shared with the impersonated SA's email (Editor).
//   3. Neither — plain ADC. On Cloud Run this is the runtime service account;
//      share the sheet with that account's email (Editor).
//
// Concurrency caveat: the Sheets API is not transactional and ticket numbers are
// derived from the current max, so two simultaneous mints could in theory clash.
// Rare at village scale and acceptable for this POC — reconcile in the sheet if
// it ever happens. Payment idempotency (below) prevents the common double-submit.

import { GoogleAuth, Impersonated } from 'google-auth-library';
import { randomUUID, randomInt } from 'node:crypto';
import {
  DRAW_METHOD,
  TICKET_PRICE_PENNIES,
  firstNameOf,
  AlreadyDrawnError,
  EmptyPoolError,
  type Prize,
  type Payment,
  type PaymentStatus,
  type Entry,
  type PublicEntry,
  type Totals,
  type Draw,
  type DrawResult,
} from './raffle';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// --- tabs & columns --------------------------------------------------------

const TAB = {
  PRIZES: 'Prizes',
  SETTINGS: 'Settings',
  PAYMENTS: 'Payments',
  ENTRIES: 'Entries',
  DRAWS: 'Draws',
} as const;

const HEADERS: Record<string, string[]> = {
  [TAB.PRIZES]: ['id', 'name', 'description', 'donor', 'display_order', 'star', 'donor_url'],
  [TAB.SETTINGS]: ['key', 'value'],
  [TAB.PAYMENTS]: [
    'payment_id', 'entrant_name', 'entrant_email', 'entrant_phone', 'consent_at',
    'quantity', 'amount_pennies', 'currency', 'status', 'square_payment_id', 'created_at',
  ],
  [TAB.ENTRIES]: [
    'ticket_number', 'entrant_name', 'entrant_email', 'entrant_phone', 'payment_id', 'created_at',
  ],
  [TAB.DRAWS]: [
    'prize_id', 'prize_name', 'winning_ticket', 'winner_name', 'winner_email', 'winner_phone',
    'pool_size', 'method', 'drawn_by', 'drawn_at',
  ],
};

// Prizes + Settings live in the (shareable) prizes spreadsheet; everything else
// in the (PII-holding) main spreadsheet. See the file header.
const PRIZES_SHEET_TABS = new Set<string>([TAB.PRIZES, TAB.SETTINGS]);

// --- config / auth ---------------------------------------------------------

function env(key: string): string | undefined {
  return process.env[key] ?? (import.meta.env as Record<string, string | undefined>)[key];
}

export function isRaffleSheetConfigured(): boolean {
  return Boolean(env('RAFFLE_SHEET_ID'));
}

function mainSheetId(): string {
  const id = env('RAFFLE_SHEET_ID');
  if (!id) throw new Error('RAFFLE_SHEET_ID not set');
  return id;
}
function prizesSheetId(): string {
  return env('RAFFLE_PRIZES_SHEET_ID') || mainSheetId();
}
function sheetIdForTab(tab: string): string {
  return PRIZES_SHEET_TABS.has(tab) ? prizesSheetId() : mainSheetId();
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
let getToken: (() => Promise<string>) | null = null;
function tokenGetter(): () => Promise<string> {
  if (getToken) return getToken;
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? import.meta.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const impersonate =
    process.env.RAFFLE_IMPERSONATE_SA ?? import.meta.env.RAFFLE_IMPERSONATE_SA;
  const auth = raw
    ? new GoogleAuth({ scopes: SCOPES, credentials: JSON.parse(raw) })
    : new GoogleAuth({ scopes: SCOPES }); // ADC (Cloud Run runtime SA, or local gcloud)

  if (impersonate && !raw) {
    let imp: Impersonated | null = null;
    getToken = async () => {
      if (!imp) {
        imp = new Impersonated({
          sourceClient: await auth.getClient(),
          targetPrincipal: impersonate,
          lifetime: 3600,
          delegates: [],
          targetScopes: SCOPES,
        });
      }
      const { token } = await imp.getAccessToken();
      if (!token) throw new Error('Impersonated access token was empty');
      return token;
    };
  } else {
    getToken = async () => {
      const token = await auth.getAccessToken();
      if (!token) throw new Error('Access token was empty');
      return token;
    };
  }
  return getToken;
}

async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await tokenGetter()();
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
  // Readable UK-ish timestamp; sheet owner can reformat.
  return new Date().toISOString().replace('T', ' ').slice(0, 16);
}

function a1(tab: string, ref: string): string {
  return `'${tab.replace(/'/g, "''")}'!${ref}`;
}

// --- tab resolution / creation ---------------------------------------------

interface TabMeta { title: string; sheetId: number }
// Cached per spreadsheet id (a tab name could exist in either sheet).
const metaCache = new Map<string, Map<string, TabMeta>>();

async function loadMeta(ssId: string): Promise<Map<string, TabMeta>> {
  const cached = metaCache.get(ssId);
  if (cached) return cached;
  const res = await authedFetch(`${SHEETS_BASE}/${ssId}?fields=sheets.properties(title,sheetId)`);
  if (!res.ok) throw new Error(`Sheet meta failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const map = new Map<string, TabMeta>();
  for (const s of data.sheets ?? []) {
    const p = s?.properties;
    if (p?.title != null) map.set(String(p.title).toLowerCase(), { title: p.title, sheetId: p.sheetId });
  }
  metaCache.set(ssId, map);
  return map;
}

// Ensure a tab exists with its header row. Creates the tab if missing. Idempotent.
const ensured = new Set<string>();
async function ensureTab(tab: string): Promise<void> {
  if (ensured.has(tab)) return;
  const ssId = sheetIdForTab(tab);
  let meta = await loadMeta(ssId);
  if (!meta.has(tab.toLowerCase())) {
    const res = await authedFetch(`${SHEETS_BASE}/${ssId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    });
    if (!res.ok) throw new Error(`Add tab "${tab}" failed: ${res.status} ${await res.text()}`);
    metaCache.delete(ssId); // invalidate
    meta = await loadMeta(ssId);
  }
  await ensureHeader(tab);
  ensured.add(tab);
}

async function ensureHeader(tab: string): Promise<void> {
  const ssId = sheetIdForTab(tab);
  const header = HEADERS[tab];
  const lastCol = String.fromCharCode(64 + header.length); // A..K (<=26 cols)
  const range = encodeURIComponent(a1(tab, `A1:${lastCol}1`));
  const res = await authedFetch(`${SHEETS_BASE}/${ssId}/values/${range}`);
  if (res.ok) {
    const data = await res.json();
    if ((data.values?.[0] ?? [])[0] === header[0]) return; // already headed
  }
  await authedFetch(`${SHEETS_BASE}/${ssId}/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [header] }),
  });
}

// --- low-level row ops -----------------------------------------------------

// Read data rows of a tab (header dropped), each with its 1-based sheet row.
async function readRows(tab: string): Promise<{ sheetRow: number; data: string[] }[]> {
  await ensureTab(tab);
  const ssId = sheetIdForTab(tab);
  const range = encodeURIComponent(a1(tab, 'A1:Z'));
  const res = await authedFetch(`${SHEETS_BASE}/${ssId}/values/${range}`);
  if (!res.ok) throw new Error(`Read ${tab} failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const values = (json.values ?? []) as string[][];
  const out: { sheetRow: number; data: string[] }[] = [];
  values.forEach((data, i) => {
    if (i === 0) return; // header
    if (data.some((c) => String(c).trim() !== '')) out.push({ sheetRow: i + 1, data });
  });
  return out;
}

// RAW, not USER_ENTERED: we write our own literal strings and must NOT let
// Sheets coerce them — e.g. a phone like "07700900123" would otherwise be read
// as a number and lose its leading zero.
async function appendRows(tab: string, rows: string[][]): Promise<void> {
  if (rows.length === 0) return;
  await ensureTab(tab);
  const ssId = sheetIdForTab(tab);
  const range = encodeURIComponent(a1(tab, 'A1'));
  const res = await authedFetch(
    `${SHEETS_BASE}/${ssId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows }) }
  );
  if (!res.ok) throw new Error(`Append ${tab} failed: ${res.status} ${await res.text()}`);
}

async function updateCells(tab: string, updates: { range: string; values: string[][] }[]): Promise<void> {
  if (updates.length === 0) return;
  const ssId = sheetIdForTab(tab);
  const res = await authedFetch(`${SHEETS_BASE}/${ssId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`);
}

// --- mappers ---------------------------------------------------------------

function cell(data: string[], i: number): string {
  return (data[i] ?? '').trim();
}

function isTruthy(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === '✓' || s === 'x';
}

function toPayment(sheetRow: number, d: string[]): Payment {
  return {
    paymentId: cell(d, 0),
    entrantName: cell(d, 1),
    entrantEmail: cell(d, 2),
    entrantPhone: cell(d, 3),
    consentAt: cell(d, 4),
    quantity: Number(cell(d, 5) || 0),
    amountPennies: Number(cell(d, 6) || 0),
    currency: cell(d, 7) || 'GBP',
    status: (cell(d, 8) || 'pending') as PaymentStatus,
    squarePaymentId: cell(d, 9),
    createdAt: cell(d, 10),
    sheetRow,
  };
}

function toEntry(d: string[]): Entry {
  return {
    ticketNumber: cell(d, 0),
    entrantName: cell(d, 1),
    entrantEmail: cell(d, 2),
    entrantPhone: cell(d, 3),
    paymentId: cell(d, 4),
    createdAt: cell(d, 5),
  };
}

function toDraw(d: string[]): Draw {
  return {
    prizeId: cell(d, 0),
    prizeName: cell(d, 1),
    winningTicket: cell(d, 2),
    winnerName: cell(d, 3),
    winnerEmail: cell(d, 4),
    winnerPhone: cell(d, 5),
    poolSize: Number(cell(d, 6) || 0),
    method: cell(d, 7),
    drawnBy: cell(d, 8),
    drawnAt: cell(d, 9),
  };
}

// --- ticket numbers --------------------------------------------------------

const TICKET_PREFIX = 'MB-';
function ticketNum(n: number): string {
  return `${TICKET_PREFIX}${String(n).padStart(4, '0')}`;
}
// Next sequence number = 1 + the highest existing MB- number. Best-effort
// gapless; see the concurrency caveat at the top of this file.
function nextTicketStart(entries: Entry[]): number {
  let max = 0;
  for (const e of entries) {
    const m = e.ticketNumber.match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

// --- public API ------------------------------------------------------------

// Prizes in DISPLAY order: the star (headline) prize first, then by display_order.
// (On the day the draw runs in REVERSE — star last — see recordDraw callers.)
export async function getPrizes(): Promise<Prize[]> {
  const rows = await readRows(TAB.PRIZES);
  return rows
    .map(({ data }) => ({
      id: cell(data, 0),
      name: cell(data, 1),
      description: cell(data, 2) || undefined,
      donor: cell(data, 3) || undefined,
      displayOrder: Number(cell(data, 4) || 0),
      star: isTruthy(cell(data, 5)),
      donorUrl: cell(data, 6) || undefined,
    }))
    .filter((p) => p.id && p.name)
    .sort((a, b) =>
      Number(b.star) - Number(a.star) || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)
    );
}

// --- settings (key/value config in the prizes sheet) -----------------------

export async function getSettings(): Promise<Map<string, string>> {
  const rows = await readRows(TAB.SETTINGS);
  const map = new Map<string, string>();
  for (const { data } of rows) {
    const k = cell(data, 0).toLowerCase();
    if (k) map.set(k, cell(data, 1));
  }
  return map;
}

export async function getEntryDeadlineRaw(): Promise<string> {
  return (await getSettings()).get('entry_deadline') ?? '';
}

// Create a pending payment at form-submit. Records entrant + consent; mints NO
// tickets yet (those come only after Square confirms). paymentId doubles as the
// Square idempotency key. Returns the new paymentId.
export async function createPendingPayment(input: {
  name: string;
  email: string;
  phone: string;
  quantity: number;
}): Promise<{ paymentId: string }> {
  const paymentId = randomUUID();
  const amount = input.quantity * TICKET_PRICE_PENNIES;
  const stamp = nowStamp();
  await appendRows(TAB.PAYMENTS, [[
    paymentId,
    input.name.trim(),
    input.email.trim().toLowerCase(),
    input.phone.trim(),
    stamp, // consent_at — box was ticked to submit
    String(input.quantity),
    String(amount),
    'GBP',
    'pending',
    '', // square_payment_id
    stamp,
  ]]);
  return { paymentId };
}

export async function getPayment(paymentId: string): Promise<Payment | null> {
  const rows = await readRows(TAB.PAYMENTS);
  const found = rows.find(({ data }) => cell(data, 0) === paymentId);
  return found ? toPayment(found.sheetRow, found.data) : null;
}

async function ticketsForPayment(paymentId: string): Promise<string[]> {
  const rows = await readRows(TAB.ENTRIES);
  return rows
    .map(({ data }) => toEntry(data))
    .filter((e) => e.paymentId === paymentId)
    .map((e) => e.ticketNumber);
}

export async function markPaymentFailed(paymentId: string): Promise<void> {
  const p = await getPayment(paymentId);
  if (!p) return;
  await updateCells(TAB.PAYMENTS, [{ range: a1(TAB.PAYMENTS, `I${p.sheetRow}`), values: [['failed']] }]);
}

// Mark a payment completed and mint `quantity` tickets, in as few writes as the
// Sheets API allows. Idempotent: if the payment is already completed, returns
// the tickets already minted rather than minting again (handles retries).
export async function completePaymentAndMintEntries(
  paymentId: string,
  squarePaymentId: string
): Promise<{ tickets: string[] }> {
  const payment = await getPayment(paymentId);
  if (!payment) throw new Error(`Unknown payment ${paymentId}`);

  if (payment.status === 'completed') {
    return { tickets: await ticketsForPayment(paymentId) };
  }

  const existing = (await readRows(TAB.ENTRIES)).map(({ data }) => toEntry(data));
  let seq = nextTicketStart(existing);
  const stamp = nowStamp();

  const rows: string[][] = [];
  const tickets: string[] = [];
  for (let i = 0; i < payment.quantity; i++) {
    const t = ticketNum(seq++);
    tickets.push(t);
    rows.push([t, payment.entrantName, payment.entrantEmail, payment.entrantPhone, paymentId, stamp]);
  }

  // Mint tickets first, then flip the payment to completed. If the status write
  // fails after minting, the payment stays 'pending' but tickets exist and are
  // discoverable by paymentId — log loudly so it can be reconciled, never drop.
  await appendRows(TAB.ENTRIES, rows);
  await updateCells(TAB.PAYMENTS, [
    { range: a1(TAB.PAYMENTS, `I${payment.sheetRow}:J${payment.sheetRow}`), values: [['completed', squarePaymentId]] },
  ]);
  return { tickets };
}

export async function getPublicEntries(): Promise<{
  entries: PublicEntry[];
  totals: Totals;
}> {
  const entries = (await readRows(TAB.ENTRIES)).map(({ data }) => toEntry(data));
  const emails = new Set(entries.map((e) => e.entrantEmail.toLowerCase()).filter(Boolean));
  const list: PublicEntry[] = entries
    .map((e) => ({ ticketNumber: e.ticketNumber, firstName: firstNameOf(e.entrantName) }))
    .sort((a, b) => a.ticketNumber.localeCompare(b.ticketNumber, undefined, { numeric: true }));
  return {
    entries: list,
    totals: { entries: entries.length, entrants: emails.size, pennies: entries.length * TICKET_PRICE_PENNIES },
  };
}

export async function getTotals(): Promise<Totals> {
  return (await getPublicEntries()).totals;
}

export async function getDraws(): Promise<Draw[]> {
  return (await readRows(TAB.DRAWS)).map(({ data }) => toDraw(data));
}

// Run the draw for one prize. Refuses a second draw for the same prize; selects
// with crypto.randomInt; records an audit row. Rule: ONE PRIZE PER TICKET — a
// ticket that already won is removed from the pool, but a person's other tickets
// stay eligible, so someone can win more than one prize with different tickets.
export async function recordDraw(prize: Prize, drawnBy: string): Promise<DrawResult> {
  const draws = await getDraws();
  if (draws.some((d) => d.prizeId === prize.id)) {
    throw new AlreadyDrawnError(`Prize "${prize.name}" has already been drawn.`);
  }

  const entries = (await readRows(TAB.ENTRIES)).map(({ data }) => toEntry(data));
  const wonTickets = new Set(draws.map((d) => d.winningTicket).filter(Boolean));
  const pool = entries.filter((e) => !wonTickets.has(e.ticketNumber));
  if (pool.length === 0) {
    throw new EmptyPoolError('No eligible tickets to draw from.');
  }

  const winner = pool[randomInt(0, pool.length)]; // cryptographically sound, uniform
  await appendRows(TAB.DRAWS, [[
    prize.id,
    prize.name,
    winner.ticketNumber,
    winner.entrantName,
    winner.entrantEmail,
    winner.entrantPhone,
    String(pool.length),
    DRAW_METHOD,
    drawnBy,
    nowStamp(),
  ]]);

  return {
    prizeId: prize.id,
    ticket: winner.ticketNumber,
    name: winner.entrantName,
    phone: winner.entrantPhone,
    poolSize: pool.length,
  };
}
