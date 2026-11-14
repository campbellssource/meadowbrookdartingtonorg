// Identifiers for Gift Aid records: GA-7K2QX4, DN-…, SD-…, and DI-… for intents.
//
// Crockford base32 from a CSPRNG, the same alphabet as booking references and for
// the same reasons: read down a phone or off a paper form without 0/O confusion,
// and not sequential, so an ID reveals nothing about how many donors there are.

import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function random(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export const newDeclarationId = (): string => `GA-${random(6)}`;
export const newDonationId = (): string => `DN-${random(6)}`;
export const newSmallDonationId = (): string => `SD-${random(6)}`;
/**
 * Longer, because it doubles as the Square idempotency key and reference_id, and
 * because it is what tells the webhook "this payment is a donation we started".
 */
export const newIntentId = (): string => `DI-${random(12)}`;

export const isIntentId = (s: unknown): s is string =>
  typeof s === 'string' && /^DI-[0-9A-Z]{12}$/.test(s);
