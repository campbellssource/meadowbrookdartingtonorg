// Wiring: the real store, the real sheet, the real Square account behind /donate.
//
// Donations use /donate's own credentials (SQUARE_ACCESS_TOKEN, PUBLIC_SQUARE_*),
// not the booking ones, as `spec/booking/04` requires. Reading a payment back needs
// the same token that took it.

import { env } from '../booking/env.ts';
import { send, alertEmail } from '../booking/email.ts';
import { firestoreStore } from './store.ts';
import { googleSheets } from './sheets.ts';
import { trySync } from './sync.ts';
import { thankYouEmail } from './email.ts';
import { formatPounds } from './declaration.ts';
import type { WebhookDeps, SquarePayment, SquareRefund } from './webhook.ts';

const API_VERSION = '2024-01-17';

function squareBase(): string {
  return (env('PUBLIC_SQUARE_ENVIRONMENT') ?? 'production') === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

async function squareGet(path: string): Promise<Record<string, any> | null> {
  const token = env('SQUARE_ACCESS_TOKEN');
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN is not set');
  const res = await fetch(`${squareBase()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Square-Version': API_VERSION },
  });
  if (res.status === 404) return null;
  // Anything else is worth Square retrying the webhook for.
  if (!res.ok) throw new Error(`Square ${path} returned ${res.status}`);
  return res.json();
}

/** Alerts are best-effort: a failed alert must never fail a recorded donation. */
export async function alert(subject: string, lines: string[]): Promise<void> {
  try { await send(alertEmail(subject, lines)); }
  catch (err) { console.error('gift-aid: alert failed', err); }
}

export const webhookDeps: WebhookDeps = {
  store: firestoreStore,
  getPayment: async (id) => ((await squareGet(`/v2/payments/${encodeURIComponent(id)}`))?.payment ?? null) as SquarePayment | null,
  getRefund: async (id) => ((await squareGet(`/v2/refunds/${encodeURIComponent(id)}`))?.refund ?? null) as SquareRefund | null,

  async afterRecorded({ declaration, donation }, intent) {
    if (declaration) await trySync(firestoreStore, googleSheets, 'declaration', declaration.id);
    await trySync(firestoreStore, googleSheets, 'donation', donation.id);
    try {
      const firstName = declaration?.firstName ?? intent.name.split(/\s+/)[0] ?? 'there';
      await send(thankYouEmail(intent.email, donation, declaration, firstName));
    } catch (err) {
      console.error('gift-aid: thank-you email failed', { donation: donation.id, err: String(err) });
      await alert('Donation thank-you email failed', [
        `Donation ${donation.id} (${formatPounds(donation.amountPence)}) was recorded, but the thank-you email did not send.`,
        declaration ? `It carried Gift Aid declaration ${declaration.id}; the donor has no copy of it yet.` : 'No Gift Aid declaration.',
        String(err),
      ]);
    }
  },

  async afterRefunded(donation, refundPence) {
    await trySync(firestoreStore, googleSheets, 'donation', donation.id);
    const partial = donation.refundedPence < donation.amountPence;
    await alert(`Donation refunded${partial ? ' (partly)' : ''}: ${donation.id}`, [
      `Square refunded ${formatPounds(refundPence)} of donation ${donation.id} (${formatPounds(donation.amountPence)}).`,
      'It is now marked Refunded in Firestore and on the Donations tab, so it will not be claimed.',
      ...(partial ? ['This was a partial refund. If the remainder should still be claimed, re-enter the net amount as a new donation.'] : []),
    ]);
  },
};
