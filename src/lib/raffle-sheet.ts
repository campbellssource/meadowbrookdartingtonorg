// Google Sheet that backs the Extravaganza raffle. One spreadsheet, four tabs:
//   Prizes   — hand-editable list of prizes
//   Payments — one row per attempt; also the entrant + consent record + the
//              Square idempotency key (paymentId)
//   Entries  — the ticket pool (one row per ticket), denormalised with entrant
//              details so the draw / public list / winner contact need no joins
//   Draws    — one row per prize once drawn (audit: method, pool size, who, when)
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
  EXCLUDE_PREVIOUS_WINNERS,
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
  PAYMENTS: 'Payments',
  ENTRIES: 'Entries',
  DRAWS: 'Draws',
} as const;

const HEADERS: Record<string, string[]> = {
  [TAB.PRIZES]: ['id', 'name', 'description', 'donor', 'display_order'],
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

// --- config / auth ---------------------------------------------------------

export function isRaffleSheetConfigured(): boolean {
  return Boolean(process.env.RAFFLE_SHEET_ID ?? import.meta.env.RAFFLE_SHEET_ID);
}

function sheetId(): string {
  const id = process.env.RAFFLE_SHEET_ID ?? import.meta.env.RAFFLE_SHEET_ID;
  if (!id) throw new Error('RAFFLE_SHEET_ID not set');
  return id;
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
let metaCache: Map<string, TabMeta> | null = null;

async function loadMeta(): Promise<Map<string, TabMeta>> {
  if (metaCache) return metaCache;
  const res = await authedFetch(
    `${SHEETS_BASE}/${sheetId()}?fields=sheets.properties(title,sheetId)`
  );
  if (!res.ok) throw new Error(`Sheet meta failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const map = new Map<string, TabMeta>();
  for (const s of data.sheets ?? []) {
    const p = s?.properties;
    if (p?.title != null) map.set(String(p.title).toLowerCase(), { title: p.title, sheetId: p.sheetId });
  }
  metaCache = map;
  return map;
}

// Ensure a tab exists with its header row. Creates the tab if missing. Idempotent.
const ensured = new Set<string>();
async function ensureTab(tab: string): Promise<void> {
  if (ensured.has(tab)) return;
  let meta = await loadMeta();
  if (!meta.has(tab.toLowerCase())) {
    const res = await authedFetch(`${SHEETS_BASE}/${sheetId()}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    });
    if (!res.ok) throw new Error(`Add tab "${tab}" failed: ${res.status} ${await res.text()}`);
    metaCache = null; // invalidate
    meta = await loadMeta();
  }
  await ensureHeader(tab);
  ensured.add(tab);
}

async function ensureHeader(tab: string): Promise<void> {
  const header = HEADERS[tab];
  const lastCol = String.fromCharCode(64 + header.length); // A..K (<=26 cols)
  const range = encodeURIComponent(a1(tab, `A1:${lastCol}1`));
  const res = await authedFetch(`${SHEETS_BASE}/${sheetId()}/values/${range}`);
  if (res.ok) {
    const data = await res.json();
    if ((data.values?.[0] ?? [])[0] === header[0]) return; // already headed
  }
  await authedFetch(`${SHEETS_BASE}/${sheetId()}/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [header] }),
  });
}

// --- low-level row ops -----------------------------------------------------

// Read data rows of a tab (header dropped), each with its 1-based sheet row.
async function readRows(tab: string): Promise<{ sheetRow: number; data: string[] }[]> {
  await ensureTab(tab);
  const range = encodeURIComponent(a1(tab, 'A1:Z'));
  const res = await authedFetch(`${SHEETS_BASE}/${sheetId()}/values/${range}`);
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
  const range = encodeURIComponent(a1(tab, 'A1'));
  const res = await authedFetch(
    `${SHEETS_BASE}/${sheetId()}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows }) }
  );
  if (!res.ok) throw new Error(`Append ${tab} failed: ${res.status} ${await res.text()}`);
}

async function updateCells(updates: { range: string; values: string[][] }[]): Promise<void> {
  if (updates.length === 0) return;
  const res = await authedFetch(`${SHEETS_BASE}/${sheetId()}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
  });
  if (!res.ok) throw new Error(`Update failed: ${res.status} ${await res.text()}`);
}

// --- mappers ---------------------------------------------------------------

function cell(data: string[], i: number): string {
  return (data[i] ?? '').trim();
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

export async function getPrizes(): Promise<Prize[]> {
  const rows = await readRows(TAB.PRIZES);
  return rows
    .map(({ data }) => ({
      id: cell(data, 0),
      name: cell(data, 1),
      description: cell(data, 2) || undefined,
      donor: cell(data, 3) || undefined,
      displayOrder: Number(cell(data, 4) || 0),
    }))
    .filter((p) => p.id && p.name)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
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
  await updateCells([{ range: a1(TAB.PAYMENTS, `I${p.sheetRow}`), values: [['failed']] }]);
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
  await updateCells([
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

// Run the draw for one prize. Refuses a second draw for the same prize; honours
// EXCLUDE_PREVIOUS_WINNERS; selects with crypto.randomInt; records an audit row.
export async function recordDraw(prize: Prize, drawnBy: string): Promise<DrawResult> {
  const draws = await getDraws();
  if (draws.some((d) => d.prizeId === prize.id)) {
    throw new AlreadyDrawnError(`Prize "${prize.name}" has already been drawn.`);
  }

  const entries = (await readRows(TAB.ENTRIES)).map(({ data }) => toEntry(data));
  let pool = entries;
  if (EXCLUDE_PREVIOUS_WINNERS) {
    const alreadyWon = new Set(draws.map((d) => d.winnerEmail.toLowerCase()).filter(Boolean));
    pool = entries.filter((e) => !alreadyWon.has(e.entrantEmail.toLowerCase()));
  }
  if (pool.length === 0) {
    throw new EmptyPoolError('No eligible entries to draw from.');
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
