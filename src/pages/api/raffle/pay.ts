import type { APIRoute } from 'astro';
import {
  TICKET_PRICE_PENNIES,
  raffleSquareConfig,
  squareApiBase,
} from '../../../lib/raffle';
import {
  getPayment,
  completePaymentAndMintEntries,
  markPaymentFailed,
  isRaffleSheetConfigured,
} from '../../../lib/raffle-sheet';
import { sendConfirmationEmail } from '../../../lib/raffle-email';

// Payment step: take the Square card nonce (sourceId) + our paymentId, charge
// the card, and on success mint the tickets. The amount is recomputed
// server-side from the stored quantity — the client never supplies an amount.
// The paymentId is the Square idempotency key, so retrying the same request
// can't double-charge. Minting is guarded by the payment's own status, so it
// can't double-issue tickets.

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  if (!isRaffleSheetConfigured()) {
    return json({ error: 'The raffle is not available right now. Please try again later.' }, 503);
  }

  const { locationId, environment, accessToken } = raffleSquareConfig();
  if (!accessToken || !locationId) {
    return json({ error: 'Payments are not configured. Please get in touch to enter.' }, 500);
  }

  let paymentId = '';
  let sourceId = '';
  try {
    const b = await request.json();
    paymentId = String(b.paymentId ?? '').trim();
    sourceId = String(b.sourceId ?? '').trim();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (!paymentId || !sourceId) return json({ error: 'Missing payment details.' }, 400);

  const payment = await getPayment(paymentId);
  if (!payment) return json({ error: 'We could not find your entry. Please start again.' }, 404);

  // Already paid? Return the tickets already minted (idempotent, no re-charge).
  if (payment.status === 'completed') {
    const { tickets } = await completePaymentAndMintEntries(paymentId, payment.squarePaymentId);
    return json({ success: true, tickets });
  }

  // Recompute the amount server-side. NEVER trust a client-supplied amount.
  const amount = payment.quantity * TICKET_PRICE_PENNIES;

  let squareRes: Response;
  let data: any;
  try {
    squareRes = await fetch(`${squareApiBase(environment)}/v2/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-17',
      },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: paymentId, // one key per payment attempt
        amount_money: { amount, currency: 'GBP' },
        location_id: locationId,
        note: `Meadowbrook Extravaganza raffle — ${payment.quantity} ticket(s)`,
      }),
    });
    data = await squareRes.json();
  } catch (err) {
    console.error('raffle pay: Square request failed', paymentId, err);
    return json({ error: 'Could not reach the payment provider. Please try again.' }, 502);
  }

  if (squareRes.ok && data.payment?.status === 'COMPLETED') {
    try {
      const { tickets } = await completePaymentAndMintEntries(paymentId, data.payment.id);
      // Best-effort receipt email (off by default); never blocks the response.
      await sendConfirmationEmail({ name: payment.entrantName, email: payment.entrantEmail, tickets })
        .catch((e) => console.warn('raffle pay: confirmation email failed', e));
      return json({ success: true, tickets });
    } catch (err) {
      // Square took the money but we failed to mint. Do NOT silently drop it —
      // log loudly with both ids so it can be reconciled by hand.
      console.error(
        'raffle pay: MINT FAILED after successful Square payment',
        { paymentId, squarePaymentId: data.payment?.id },
        err
      );
      return json(
        { error: `Your payment went through but we hit a snag issuing tickets. Please contact us and quote reference ${paymentId}.` },
        500
      );
    }
  }

  // Declined / failed: mint nothing, mark failed, return a clear message.
  await markPaymentFailed(paymentId).catch(() => {});
  const detail = data?.errors?.[0]?.detail ?? 'Payment failed. Please check your card and try again.';
  return json({ error: detail }, squareRes.ok ? 502 : squareRes.status);
};
