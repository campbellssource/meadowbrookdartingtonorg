// Validating a Gift Aid declaration.
//
// One function for every way in -- the online form, the tablet, a paper form keyed
// in, a verbal declaration -- so a declaration accepted by one door is accepted by
// all of them. Pure: no I/O, no clock unless given one.
//
// Errors are per field, because a donor on a tablet fixing their postcode should
// not have to hunt for which of nine boxes was wrong.

import type { Scope } from './declaration.ts';

export type DeclarationMethod = 'Online' | 'Tablet' | 'Paper' | 'Verbal';

export const SCOPES: readonly Scope[] = ['Single', 'Enduring'];
export const METHODS: readonly DeclarationMethod[] = ['Online', 'Tablet', 'Paper', 'Verbal'];

export interface ValidDeclaration {
  title: string | null;
  firstName: string;
  lastName: string;
  houseNameOrNumber: string;
  addressLine: string;
  town: string;
  /** Upper case, one space before the inward code: "TQ9 6EJ". */
  postcode: string;
  email: string | null;
  scope: Scope;
  method: DeclarationMethod;
  /** yyyy-mm-dd, London. */
  madeOn: string;
  scanLink: string | null;
  notes: string | null;
}

export type FieldErrors = Partial<Record<keyof ValidDeclaration | 'optIn', string>>;

export type ValidationResult =
  | { ok: true; value: ValidDeclaration }
  | { ok: false; errors: FieldErrors };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The general UK shape: outward code (area letters, district digit, optional
// letter or digit) and inward code (digit, two letters). Deliberately not the
// exhaustive list of valid letters per position -- a postcode that merely looks
// odd is better accepted and checked by the bookkeeper than refused at the door.
// GIR 0AA is the one historic exception still in use.
const POSTCODE_RE = /^(?:[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}|GIR0AA)$/;

/**
 * "tq9 6ej", "TQ96EJ", " tq9  6ej " -> "TQ9 6EJ". Null if it is not a UK postcode.
 */
export function normalisePostcode(input: string): string | null {
  const compact = String(input ?? '').toUpperCase().replace(/\s+/g, '');
  if (!POSTCODE_RE.test(compact)) return null;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

/** A real calendar date in yyyy-mm-dd, not 2026-02-31. */
export function isIsoDate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today in London, as yyyy-mm-dd. */
export function londonToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

const SCAN_HOSTS = ['drive.google.com', 'docs.google.com'];

function cleanScanLink(raw: unknown): string | null | false {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || !SCAN_HOSTS.includes(u.hostname)) return false;
    return u.toString();
  } catch {
    return false;
  }
}

const text = (v: unknown, max: number): string =>
  String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max + 1);

export interface ValidateOptions {
  method: DeclarationMethod;
  now?: Date;
}

/**
 * Validates a declaration as typed.
 *
 * `optIn` must be the boolean `true`. Not "true", not 1, not "on": a declaration
 * is the donor's own explicit act, and anything that merely looks truthy could be a
 * default nobody chose.
 */
export function validateDeclaration(raw: Record<string, unknown>, opts: ValidateOptions): ValidationResult {
  const errors: FieldErrors = {};
  const now = opts.now ?? new Date();
  const today = londonToday(now);
  const method = opts.method;

  if (raw.optIn !== true) errors.optIn = 'Please tick the box to confirm the Gift Aid declaration.';

  const title = text(raw.title, 4);
  if (title.length > 4) errors.title = 'Title can be at most 4 characters, for example Mrs or Dr.';

  const firstName = text(raw.firstName, 35);
  if (!firstName) errors.firstName = 'Please enter a first name.';
  else if (firstName.length > 35) errors.firstName = 'First name can be at most 35 characters.';

  const lastName = text(raw.lastName, 35);
  if (!lastName) errors.lastName = 'Please enter a last name.';
  else if (lastName.length > 35) errors.lastName = 'Last name can be at most 35 characters.';

  const houseNameOrNumber = text(raw.houseNameOrNumber, 40);
  if (!houseNameOrNumber) errors.houseNameOrNumber = 'Please enter a house name or number.';
  else if (houseNameOrNumber.length > 40) errors.houseNameOrNumber = 'House name or number is too long.';

  const addressLine = text(raw.addressLine, 100);
  if (!addressLine) errors.addressLine = 'Please enter the street or first line of the address.';
  else if (addressLine.length > 100) errors.addressLine = 'Address is too long.';

  const town = text(raw.town, 100);
  if (!town) errors.town = 'Please enter a town.';
  else if (town.length > 100) errors.town = 'Town is too long.';

  const postcode = normalisePostcode(String(raw.postcode ?? ''));
  if (!postcode) errors.postcode = 'Please enter a UK postcode, for example TQ9 6EJ.';

  const emailRaw = String(raw.email ?? '').trim().toLowerCase().slice(0, 254);
  const emailRequired = method === 'Online' || method === 'Tablet';
  if (emailRaw && !EMAIL_RE.test(emailRaw)) errors.email = 'Please enter a valid email address.';
  else if (!emailRaw && emailRequired) errors.email = 'Please enter an email address.';

  const scope = raw.scope as Scope;
  if (!SCOPES.includes(scope)) errors.scope = 'Please choose which donations this covers.';

  if (!METHODS.includes(method)) throw new Error(`Unknown declaration method ${method}`);

  // Online and on the tablet a declaration is made now, whatever the client says.
  // A paper form or a phone call happened on a day someone has to tell us.
  let madeOn = today;
  if (method === 'Paper' || method === 'Verbal') {
    madeOn = String(raw.madeOn ?? '').trim();
    if (!isIsoDate(madeOn)) errors.madeOn = method === 'Paper'
      ? 'Please enter the date the form was signed.'
      : 'Please enter the date the declaration was made.';
    else if (madeOn > today) errors.madeOn = 'That date is in the future.';
  }

  let scanLink: string | null = null;
  if (method === 'Paper') {
    const cleaned = cleanScanLink(raw.scanLink);
    if (cleaned === false) errors.scanLink = 'The scan link must be a Google Drive link.';
    else scanLink = cleaned;
  }

  const notesRaw = String(raw.notes ?? '').trim().slice(0, 500);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title: title || null,
      firstName, lastName, houseNameOrNumber, addressLine, town,
      postcode: postcode!,
      email: emailRaw || null,
      scope, method, madeOn, scanLink,
      notes: notesRaw || null,
    },
  };
}

// --- Offline donations and small collections -----------------------------

export type DonationMethod = 'Online' | 'Cheque' | 'Bank transfer' | 'Standing order' | 'Cash';
export type Campaign = 'Pool appeal' | 'General' | 'Event';

/** `?campaign=pool` on /donate arrives at the API as 'pool'. Anything else is General. */
export const campaignFor = (raw: unknown): Campaign => (raw === 'pool' ? 'Pool appeal' : 'General');

export const OFFLINE_METHODS: readonly DonationMethod[] = ['Cheque', 'Bank transfer', 'Standing order', 'Cash'];
export const CAMPAIGNS: readonly Campaign[] = ['Pool appeal', 'General', 'Event'];
/** Small Donations Scheme limit per gift, and the line the committee uses for cash. */
export const SMALL_DONATION_MAX_PENCE = 3000;

/** "12.50" or "£12.50" -> 1250. Null for anything else. Never a float in the result. */
export function parsePounds(input: unknown): number | null {
  const s = String(input ?? '').trim().replace(/^£/, '').replace(/,/g, '');
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export interface ValidOfflineDonation {
  declarationId: string;
  amountPence: number;
  receivedOn: string;
  method: DonationMethod;
  campaign: Campaign;
  bankReference: string | null;
  notes: string | null;
  /** Set for cash at or under the small-donations line: allowed, but worth a second look. */
  warning: string | null;
}

export function validateOfflineDonation(
  raw: Record<string, unknown>, now = new Date(),
): { ok: true; value: ValidOfflineDonation } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const declarationId = String(raw.declarationId ?? '').trim();
  if (!/^GA-[0-9A-Z]{6}$/.test(declarationId)) errors.declarationId = 'Look the donor up and choose their declaration.';

  const amountPence = parsePounds(raw.amount);
  if (amountPence === null || amountPence <= 0) errors.amount = 'Please enter an amount in pounds, for example 25 or 12.50.';

  const receivedOn = String(raw.receivedOn ?? '').trim();
  if (!isIsoDate(receivedOn)) errors.receivedOn = 'Please enter the date it was received.';
  else if (receivedOn > londonToday(now)) errors.receivedOn = 'That date is in the future.';

  const method = raw.method as DonationMethod;
  if (!OFFLINE_METHODS.includes(method)) errors.method = 'Please choose how it was given.';

  const campaign = raw.campaign as Campaign;
  if (!CAMPAIGNS.includes(campaign)) errors.campaign = 'Please choose a campaign.';

  const bankReference = String(raw.bankReference ?? '').trim().slice(0, 100) || null;
  const notes = String(raw.notes ?? '').trim().slice(0, 500) || null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const warning = method === 'Cash' && amountPence! <= SMALL_DONATION_MAX_PENCE
    ? 'Cash of £30 or less is normally logged as a small donation. Recorded here because it has a declaration.'
    : null;
  return {
    ok: true,
    value: { declarationId, amountPence: amountPence!, receivedOn, method, campaign, bankReference, notes, warning },
  };
}

export interface ValidSmallDonation {
  collectedOn: string;
  eventOrPlace: string;
  amountPence: number;
  kind: 'Cash' | 'Contactless';
  inBuilding: boolean;
  notes: string | null;
}

export function validateSmallDonation(
  raw: Record<string, unknown>, now = new Date(),
): { ok: true; value: ValidSmallDonation } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const collectedOn = String(raw.collectedOn ?? '').trim();
  if (!isIsoDate(collectedOn)) errors.collectedOn = 'Please enter the date of the collection.';
  else if (collectedOn > londonToday(now)) errors.collectedOn = 'That date is in the future.';

  const eventOrPlace = text(raw.eventOrPlace, 100);
  if (!eventOrPlace) errors.eventOrPlace = 'Please say which event or place.';

  // The total for one collection, so it can be well over £30. The £30 limit is per
  // individual gift, which is the committee's judgement at the bucket.
  const amountPence = parsePounds(raw.amount);
  if (amountPence === null || amountPence <= 0) errors.amount = 'Please enter the total collected.';

  const kind = raw.kind as 'Cash' | 'Contactless';
  if (kind !== 'Cash' && kind !== 'Contactless') errors.kind = 'Cash or contactless?';

  if (typeof raw.inBuilding !== 'boolean') errors.inBuilding = 'Was it collected in the Meadowbrook building?';

  const notes = String(raw.notes ?? '').trim().slice(0, 400) || null;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { collectedOn, eventOrPlace, amountPence: amountPence!, kind, inBuilding: raw.inBuilding as boolean, notes },
  };
}
