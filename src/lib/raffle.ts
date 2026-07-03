// Extravaganza digital raffle — shared config, types, and helpers.
//
// This raffle runs as a UK **small society lottery** (organiser: Dartington
// Recreation Association) for the 2026 Extravaganza only. See spec/raffle/ for
// the full spec and spec/raffle/IMPLEMENTATION-PLAN.md for how it maps onto this
// repo. Storage is a Google Sheet (see ./raffle-sheet.ts); payments are Square
// sandbox (see src/pages/api/raffle/pay.ts), kept on their own env vars so live
// donations stay on production.

function env(key: string): string | undefined {
  return process.env[key] ?? (import.meta.env as Record<string, string | undefined>)[key];
}

// --- Legal ticket info (small society lottery) -----------------------------
// Every ticket/receipt must, by law, show all four of these. Fixed for this
// event — hardcoded, not secrets. Rendered by the shared ticket legal footer.
export const SOCIETY_NAME = 'Dartington Recreation Association';
export const ORGANISER_NAME = 'Dartington Recreation Association';
export const ORGANISER_ADDRESS = 'Meadowbrook, Shinners Bridge, Dartington, TQ9 6JD';
export const DRAW_DATE_ISO = '2026-07-11';
export const DRAW_DATE_LABEL = '11 July 2026';
export const DRAW_TIME_LABEL = '3pm'; // drawn live on the loudspeaker at 3pm
export const DRAW_WHEN_LABEL = `${DRAW_TIME_LABEL} on ${DRAW_DATE_LABEL}`;

// --- Config ----------------------------------------------------------------
export const TICKET_PRICE_PENNIES = Number(env('RAFFLE_PRICE_PENNIES') ?? 100); // £1
export const MAX_QUANTITY = Number(env('RAFFLE_MAX_QUANTITY') ?? 20);
// Default true: a person can win at most one prize (previous winners excluded
// from later draws). Announce whatever this is at the event before drawing.
// One prize per TICKET: a winning ticket is removed from later draws, but a
// person's other tickets stay eligible — so one person can win more than one
// prize (with different tickets). Prizes are drawn in REVERSE display order, so
// the star prize (top of the list) is drawn LAST, as the finale.
export const DRAW_RULE_LABEL = 'one prize per ticket';

// Confirmation email on entry. On by default (needs a verified Brevo sender).
export const SEND_CONFIRMATION_EMAIL =
  (env('SEND_CONFIRMATION_EMAIL') ?? 'true').toLowerCase() === 'true';

export const DRAW_METHOD = 'crypto.randomInt'; // recorded on every draw (transparency)

export function formatPennies(pennies: number): string {
  const pounds = pennies / 100;
  return Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
}
export const TICKET_PRICE_LABEL = formatPennies(TICKET_PRICE_PENNIES);

// First name only for the public list — never expose full contact data.
export function firstNameOf(name: string): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

// --- Square (raffle-scoped, sandbox) ---------------------------------------
// Deliberately separate from the donate flow's PUBLIC_SQUARE_* vars so the
// raffle can be sandbox while live donations stay on production.
export interface SquareConfig {
  appId: string;
  locationId: string;
  environment: string; // 'sandbox' | 'production'
  accessToken: string;
}
export function raffleSquareConfig(): SquareConfig {
  return {
    appId: env('PUBLIC_RAFFLE_SQUARE_APPLICATION_ID') ?? '',
    locationId: env('PUBLIC_RAFFLE_SQUARE_LOCATION_ID') ?? '',
    environment: env('PUBLIC_RAFFLE_SQUARE_ENVIRONMENT') ?? 'sandbox',
    accessToken: env('RAFFLE_SQUARE_ACCESS_TOKEN') ?? '',
  };
}
export function squareApiBase(environment: string): string {
  return environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

// --- Admin auth (POC-grade ONLY) -------------------------------------------
// Shared secret via HTTP Basic auth (any username, password === ADMIN_SECRET)
// or a `raffle_admin` cookie holding the same secret. Good enough for one
// trusted operator on the day — NOT production-grade auth. Do not reuse.
export function isAdminAuthorized(request: Request): boolean {
  const secret = env('ADMIN_SECRET');
  if (!secret) return false;

  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Basic ')) {
    try {
      const pass = atob(auth.slice(6)).split(':').slice(1).join(':');
      if (pass === secret) return true;
    } catch {
      /* fall through */
    }
  }

  const cookie = request.headers.get('cookie') ?? '';
  const m = cookie.match(/(?:^|;\s*)raffle_admin=([^;]+)/);
  return Boolean(m && decodeURIComponent(m[1]) === secret);
}
export function adminChallenge(): Response {
  return new Response('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Raffle admin"' },
  });
}

// --- Domain types ----------------------------------------------------------
export interface Prize {
  id: string;
  name: string;
  description?: string;
  donor?: string;
  donorUrl?: string; // optional link to the donor's website
  displayOrder: number;
  star: boolean; // the headline prize — shown first with special treatment, drawn last
}

export type PaymentStatus = 'pending' | 'completed' | 'failed';

export interface Payment {
  paymentId: string;
  entrantName: string;
  entrantEmail: string;
  entrantPhone: string;
  consentAt: string;
  quantity: number;
  amountPennies: number;
  currency: string;
  status: PaymentStatus;
  squarePaymentId: string;
  createdAt: string;
  sheetRow: number; // 1-based row in the Payments tab
}

export interface Entry {
  ticketNumber: string;
  entrantName: string;
  entrantEmail: string;
  entrantPhone: string;
  paymentId: string;
  createdAt: string;
}

export interface PublicEntry {
  ticketNumber: string;
  firstName: string;
}

export interface Totals {
  entries: number;
  entrants: number;
  pennies: number;
}

export interface Draw {
  prizeId: string;
  prizeName: string;
  winningTicket: string;
  winnerName: string;
  winnerEmail: string;
  winnerPhone: string;
  poolSize: number;
  method: string;
  drawnBy: string;
  drawnAt: string;
}

export interface DrawResult {
  prizeId: string;
  ticket: string;
  name: string;
  phone: string;
  poolSize: number;
}

// --- Entry deadline --------------------------------------------------------
// Stored in the Settings tab (key `entry_deadline`) as an ISO 8601 timestamp
// WITH a timezone offset, e.g. 2026-07-03T18:00:00+01:00 (BST). Empty or
// unparseable means no deadline (entries always open).
export interface DeadlineStatus {
  hasDeadline: boolean;
  closed: boolean;
  at: Date | null;
}
export function entryDeadlineStatus(raw: string | undefined, now: Date = new Date()): DeadlineStatus {
  const trimmed = (raw ?? '').trim();
  const ms = trimmed ? Date.parse(trimmed) : NaN;
  if (!Number.isFinite(ms)) return { hasDeadline: false, closed: false, at: null };
  return { hasDeadline: true, closed: now.getTime() >= ms, at: new Date(ms) };
}
export function formatDeadline(at: Date): string {
  // e.g. "Fri 3 Jul, 6pm" in UK time.
  const date = at.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London',
  });
  const time = at
    .toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/London' })
    .replace(':00', '')
    .replace(/\s/g, '')
    .toLowerCase(); // "6:00 pm" -> "6pm"
  return `${date}, ${time}`;
}

// Signals used by the draw API to return clean errors (05 acceptance criteria).
export class AlreadyDrawnError extends Error {}
export class EmptyPoolError extends Error {}
