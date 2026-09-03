// Booking references: `MB-7K2QX4`.
//
// Six characters of Crockford base32 from a CSPRNG. Not sequential, because a
// guessable reference plus an email address should not be enough to find someone
// else's booking -- and sequential references also leak how many bookings the DRA
// takes, which is nobody's business.
//
// Crockford's alphabet drops I, L, O and U: no confusing 1/I or 0/O when a
// reference is read down the phone, and no accidental words.

import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 6;
const PREFIX = 'MB-';

export function generateReference(): string {
  let out = '';
  for (let i = 0; i < LENGTH; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${PREFIX}${out}`;
}

/**
 * Accepts what a human typed. Lowercase, missing prefix, spaces, and Crockford's
 * documented confusions (I/L -> 1, O -> 0) are all fixed rather than rejected --
 * somebody reading a reference off a phone screen should not be punished for it.
 */
export function normaliseReference(input: string): string | null {
  const cleaned = input.trim().toUpperCase()
    .replace(/^MB[-\s]*/, '')
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (cleaned.length !== LENGTH) return null;
  if (![...cleaned].every((c) => ALPHABET.includes(c))) return null;
  return `${PREFIX}${cleaned}`;
}

export const isValidReference = (input: string): boolean => normaliseReference(input) !== null;
