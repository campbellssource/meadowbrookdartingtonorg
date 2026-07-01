import type { APIRoute } from 'astro';
import { MAX_QUANTITY, TICKET_PRICE_PENNIES } from '../../../lib/raffle';
import { createPendingPayment, isRaffleSheetConfigured } from '../../../lib/raffle-sheet';

// Entry step: validate the form and create a PENDING payment. No tickets are
// minted here — those are only created after Square confirms the payment (see
// /api/raffle/pay). Returns the paymentId, which the client hands to the
// payment step and which doubles as the Square idempotency key.

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  if (!isRaffleSheetConfigured()) {
    return json({ error: 'The raffle is not available right now. Please try again later.' }, 503);
  }

  let name = '';
  let email = '';
  let phone = '';
  let quantity = 0;
  let consent = false;
  try {
    const b = await request.json();
    name = String(b.name ?? '').trim();
    email = String(b.email ?? '').trim();
    phone = String(b.phone ?? '').trim();
    quantity = Math.floor(Number(b.quantity));
    consent = Boolean(b.consent);
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  if (!name) return json({ error: 'Please enter your name.' }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);
  if (!phone) return json({ error: 'Please enter a phone number so we can reach you if you win.' }, 400);
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return json({ error: `Please choose between 1 and ${MAX_QUANTITY} tickets.` }, 400);
  }
  if (!consent) return json({ error: 'Please tick the consent box to enter.' }, 400);

  try {
    const { paymentId } = await createPendingPayment({ name, email, phone, quantity });
    return json({ paymentId, quantity, amountPennies: quantity * TICKET_PRICE_PENNIES });
  } catch (err) {
    console.error('raffle entry error:', err);
    return json({ error: 'Something went wrong creating your entry. Please try again.' }, 502);
  }
};
