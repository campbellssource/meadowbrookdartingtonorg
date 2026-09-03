// Adding a hirer to the Brevo newsletter list, when they ask to be added.
//
// Consent rules this file exists to honour, from spec/booking/16:
//
//   - Only ever called when the booker ticked an unticked box.
//   - Never fails or delays a booking. They have paid; a marketing list is not
//     worth a 500.
//   - Never resubscribes someone who has unsubscribed. Brevo keeps that state on
//     the contact, and this code never sends `emailBlacklisted`, so adding an
//     unsubscribed contact to a list leaves them unsubscribed -- which is correct
//     and must stay that way.
//
// It reads the same transport switch as the email sender, so local testing cannot
// put real people onto the real list.

import { env } from './env.ts';

const BASE = 'https://api.brevo.com/v3';

/**
 * The exact words shown beside the checkbox, and stored on the booking.
 *
 * Proving consent means proving what was agreed to, and this sentence will be
 * edited one day. Defined once so the form and the record cannot describe
 * different promises.
 */
export const NEWSLETTER_CONSENT_TEXT =
  "Email me occasionally about what's on at Meadowbrook. No more than monthly, and you can "
  + 'unsubscribe from any email.';

/** Brevo list to add to. 2 is "newsletter" in the DRA's account. */
export function newsletterListId(): number {
  const raw = env('BOOKING_NEWSLETTER_LIST_ID');
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

export type SubscribeResult = 'created' | 'added' | 'already-subscribed' | 'skipped';

function transport(): string {
  const value = env('BOOKING_EMAIL_TRANSPORT');
  if (!value) {
    if (process.env.NODE_ENV === 'production') return 'brevo';
    throw new Error('BOOKING_EMAIL_TRANSPORT must be set outside production (console or brevo)');
  }
  return value;
}

/** Brevo wants a first and last name; people give us one string. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

async function brevo(path: string, init?: RequestInit): Promise<Response> {
  const apiKey = env('BREVO_API_KEY');
  if (!apiKey) throw new Error('BREVO_API_KEY is not set');
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * Put an address on the newsletter list, if it is not on it already.
 *
 * Looks the contact up first rather than sending one create-or-update call. An
 * upsert would overwrite the attributes of a contact who has been on the list for
 * years with whatever name they happened to type into a booking form -- and it
 * would say "created" for someone who was already a subscriber, which is the one
 * thing we might later need to be sure about.
 */
export async function subscribeToNewsletter(input: {
  email: string;
  name: string;
}): Promise<SubscribeResult> {
  const listId = newsletterListId();

  if (transport() === 'console') {
    console.log(`  [newsletter] would add ${input.email} to Brevo list ${listId}`);
    return 'skipped';
  }

  const existing = await brevo(`/contacts/${encodeURIComponent(input.email)}`);

  if (existing.status === 404) {
    const { firstName, lastName } = splitName(input.name);
    const res = await brevo('/contacts', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email,
        attributes: { FIRSTNAME: firstName, LASTNAME: lastName },
        listIds: [listId],
        // Absent on purpose. Sending emailBlacklisted:false here would resubscribe
        // someone who had opted out.
      }),
    });
    if (!res.ok) throw new Error(`Brevo create contact failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return 'created';
  }

  if (!existing.ok) {
    throw new Error(`Brevo contact lookup failed: ${existing.status} ${(await existing.text()).slice(0, 200)}`);
  }

  const contact = await existing.json() as { listIds?: number[] };
  if (contact.listIds?.includes(listId)) return 'already-subscribed';

  const res = await brevo(`/contacts/lists/${listId}/contacts/add`, {
    method: 'POST',
    body: JSON.stringify({ emails: [input.email] }),
  });
  // Brevo returns 400 "Contact already in list" if it raced us. Not an error.
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    if (res.status === 400 && /already in list/i.test(detail)) return 'already-subscribed';
    throw new Error(`Brevo add to list failed: ${res.status} ${detail}`);
  }
  return 'added';
}
