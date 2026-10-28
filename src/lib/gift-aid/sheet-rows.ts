// Firestore records -> rows for the bookkeeper's sheet.
//
// Pure, and the one place the column order lives. The sheet's columns to the right
// of these are ARRAYFORMULAs in the header row; a row one cell too wide overwrites
// a formula and every row below it silently stops being worked out. So the width
// of each row is pinned by a test, and so is the order.
//
// valueInputOption is USER_ENTERED, so the sheet parses what it is given the way it
// would parse typing. That is what turns "2026-10-25" into a real date the formulas
// can compare -- and it is also what would run "=IMPORTXML(...)" typed into a name
// field. Every free-text cell is therefore prefixed with an apostrophe, which the
// sheet treats as "this is text" and does not display. Enumerated values are
// written bare, because the formulas compare them as they are.

import type { Declaration, Donation, SmallDonation, SheetKind } from './types.ts';

export interface TabSpec {
  /** The tab's title, quoted for A1 notation when it has a space. */
  tab: string;
  /** The input columns, first to last. */
  firstColumn: 'A';
  lastColumn: string;
  /** The column whose value identifies the row, for dedupe and in-place updates. */
  idColumn: string;
  headers: readonly string[];
}

export const TABS: Record<SheetKind, TabSpec> = {
  declaration: {
    tab: 'Declarations', firstColumn: 'A', lastColumn: 'R', idColumn: 'A',
    headers: [
      'Declaration ID', 'Title', 'First name', 'Last name', 'House name or number', 'Address',
      'Town', 'Postcode', 'Email', 'Scope', 'Method', 'Date made', 'Wording version',
      'Confirmation sent (verbal only)', 'Cancelled date', 'Scan link', 'Entered by', 'Notes',
    ],
  },
  donation: {
    tab: 'Donations', firstColumn: 'A', lastColumn: 'K', idColumn: 'A',
    headers: [
      'Donation ID', 'Declaration ID', 'Date received', 'Amount (£)', 'Method', 'Campaign',
      'Source', 'Via platform (Y/N)', 'Status', 'Claim ID', 'Notes',
    ],
  },
  small: {
    // No ID column on this tab: the reference rides at the end of Notes. See the spec.
    tab: 'Small donations', firstColumn: 'A', lastColumn: 'G', idColumn: 'G',
    headers: [
      'Date collected', 'Event or place', 'Amount (£)', 'Cash or contactless',
      'In Meadowbrook building (Y/N)', 'Entered by', 'Notes',
    ],
  },
};

/** A1 range for a tab's input columns, e.g. `'Small donations'!A:G`. */
export function inputRange(kind: SheetKind): string {
  const t = TABS[kind];
  return `${quoteTab(t.tab)}!${t.firstColumn}:${t.lastColumn}`;
}

export const quoteTab = (tab: string): string =>
  /^[A-Za-z0-9_]+$/.test(tab) ? tab : `'${tab.replace(/'/g, "''")}'`;

/** Free text, kept as text whatever it looks like. Empty stays empty. */
export function asText(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  return `'${v}`;
}

/** Pence -> pounds as a plain number string the sheet reads as a number. */
export function asPounds(pence: number): string {
  if (!Number.isInteger(pence)) throw new Error(`Amount must be integer pence, got ${pence}`);
  const whole = Math.floor(pence / 100);
  const rem = pence % 100;
  return rem === 0 ? String(whole) : `${whole}.${String(rem).padStart(2, '0')}`;
}

/** Dates go in as yyyy-mm-dd and become real dates under USER_ENTERED. */
export function asDate(v: string | null | undefined): string {
  if (!v) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`Not an ISO date: ${v}`);
  return v;
}

const yn = (b: boolean): 'Y' | 'N' => (b ? 'Y' : 'N');

/** The marker that identifies a small-donation row, since that tab has no ID column. */
export const smallDonationMarker = (id: string): string => `[${id}]`;

export function declarationRow(d: Declaration): string[] {
  return [
    asText(d.id),
    asText(d.title),
    asText(d.firstName),
    asText(d.lastName),
    asText(d.houseNameOrNumber),
    asText(d.addressLine),
    asText(d.town),
    asText(d.postcode),
    asText(d.email),
    d.scope,
    d.method,
    asDate(d.madeOn),
    asText(d.wordingVersion),
    asDate(d.confirmationSentOn),
    asDate(d.cancelledOn),
    asText(d.scanLink),
    asText(d.enteredBy),
    asText(d.notes),
  ];
}

export function donationRow(d: Donation): string[] {
  const notes = [d.bankReference ? `Bank ref: ${d.bankReference}` : '', d.notes ?? '']
    .filter(Boolean).join('. ');
  return [
    asText(d.id),
    asText(d.declarationId),
    asDate(d.receivedOn),
    asPounds(d.amountPence),
    d.method,
    d.campaign,
    d.source,
    yn(d.viaPlatform),
    d.status,
    '', // Claim ID: the bookkeeper's, filled in when the gift is claimed. Never ours.
    asText(notes || null),
  ];
}

export function smallDonationRow(s: SmallDonation): string[] {
  const notes = [s.notes ?? '', smallDonationMarker(s.id)].filter(Boolean).join(' ');
  return [
    asDate(s.collectedOn),
    asText(s.eventOrPlace),
    asPounds(s.amountPence),
    s.kind,
    yn(s.inBuilding),
    asText(s.enteredBy),
    asText(notes),
  ];
}

/** Whether a cell read back from the sheet identifies this record. */
export function cellMatches(kind: SheetKind, cell: string, id: string): boolean {
  const v = String(cell ?? '').replace(/^'/, '').trim();
  return kind === 'small' ? v.endsWith(smallDonationMarker(id)) : v === id;
}

/** Column letter -> zero-based index. 'A' -> 0, 'R' -> 17. Single letters only. */
export function columnIndex(letter: string): number {
  if (!/^[A-Z]$/.test(letter)) throw new Error(`Unsupported column ${letter}`);
  return letter.charCodeAt(0) - 65;
}

/** Cells we are allowed to rewrite after the row exists. Anything else is refused. */
export const UPDATABLE: Record<SheetKind, readonly string[]> = {
  declaration: ['N', 'O'], // Confirmation sent, Cancelled date
  donation: ['I'],         // Status
  small: [],
};
