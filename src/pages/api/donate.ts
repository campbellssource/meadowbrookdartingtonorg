// POST /api/donate — card donations, optionally with a Gift Aid declaration.
//
// The charge itself is unchanged from what production taught us (see
// spec/booking/04). What is new is that a donation intent is written to Firestore
// *before* the card is charged, carrying the declaration, and the payment carries
// the intent id as its reference. The donation is recorded only when Square's
// webhook confirms the payment (api/donate/webhooks/square.ts), so a declaration
// can never be lost between "money taken" and "record written", and a payment that
// fails is never recorded at all. See spec/gift-aid/01.

import type { APIRoute } from 'astro';
import { DECLARATION_VERSION, renderDeclaration } from '../../lib/gift-aid/declaration.ts';
import { validateDeclaration, campaignFor } from '../../lib/gift-aid/validate.ts';
import { newIntentId } from '../../lib/gift-aid/ids.ts';
import { firestoreStore } from '../../lib/gift-aid/store.ts';
import type { DonationIntent } from '../../lib/gift-aid/types.ts';

export const prerender = false;

/** How long an unpaid intent (and the donor details in it) survives before TTL removes it. */
const INTENT_DAYS = 30;

export const POST: APIRoute = async ({ request }) => {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.PUBLIC_SQUARE_LOCATION_ID;
  const environment = process.env.PUBLIC_SQUARE_ENVIRONMENT ?? 'production';

  if (!accessToken || !locationId) {
    return new Response(
      JSON.stringify({ error: 'Server configuration error. Please try again later.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let sourceId: string;
  let amountPence: number;
  let donorName: string;
  let donorEmail: string;
  let body: Record<string, any>;

  try {
    body = await request.json();
    sourceId = (body.sourceId ?? '').trim();
    amountPence = Math.round(Number(body.amount));
    donorName = String(body.name ?? '').trim().slice(0, 100);
    donorEmail = String(body.email ?? '').trim().toLowerCase().slice(0, 254);
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid request.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!sourceId) {
    return new Response(
      JSON.stringify({ error: 'Payment token missing.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!amountPence || amountPence < 100) {
    return new Response(
      JSON.stringify({ error: 'Minimum donation is £1.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Gift Aid. Strict true, as everywhere: an absent, false or "true" opt-in is
  // simply a donation without a declaration, never a declaration.
  let giftAid: DonationIntent['giftAid'] = null;
  let wordingText: string | null = null;
  if (body.giftAid?.optIn === true) {
    // The page states the wording it showed. If it is not the current version the
    // donor read words we would not be recording; ask them to reload instead.
    if (body.giftAid.wordingVersion !== DECLARATION_VERSION) {
      return new Response(
        JSON.stringify({ error: 'This page is out of date. Please refresh it and try again.' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const result = validateDeclaration({ ...body.giftAid, email: donorEmail }, { method: 'Online' });
    if (!result.ok) {
      return new Response(
        JSON.stringify({ error: 'Please check your Gift Aid details.', fields: result.errors }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    giftAid = result.value;
    wordingText = renderDeclaration(giftAid.scope, amountPence);
    donorName = `${giftAid.firstName} ${giftAid.lastName}`;
  }

  if (!donorEmail) {
    return new Response(
      JSON.stringify({ error: 'Please enter your email address.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Written before the charge. If Firestore is down the donor is asked to try
  // again before any money moves -- better than taking money we cannot record.
  const now = new Date();
  const intent: DonationIntent = {
    id: newIntentId(),
    amountPence,
    campaign: campaignFor(body.campaign),
    name: donorName,
    email: donorEmail,
    giftAid,
    wordingText,
    status: 'pending',
    donationId: null,
    declarationId: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + INTENT_DAYS * 86_400_000),
    ...(process.env.NODE_ENV !== 'production' ? { isTest: true as const } : {}),
  };
  try {
    await firestoreStore.createIntent(intent);
  } catch (err) {
    console.error('donate: could not write intent', err instanceof Error ? err.message : String(err));
    return new Response(
      JSON.stringify({ error: 'We could not take your donation just now. Nothing has been charged. Please try again in a few minutes.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const baseUrl = environment === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';

  const squareRes = await fetch(`${baseUrl}/v2/payments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2024-01-17',
    },
    body: JSON.stringify({
      // Strong Customer Authentication (3-D Secure) is carried by the token
      // itself — the client runs it via tokenize(verificationDetails), so no
      // separate verification token is needed here.
      source_id: sourceId,
      // The intent id, one per request as the random key was before. The
      // reference_id is what the webhook finds the intent by, and what tells it
      // this payment is a donation rather than a booking or a card-reader sale.
      idempotency_key: intent.id,
      reference_id: intent.id,
      amount_money: {
        amount: amountPence,
        currency: 'GBP',
      },
      location_id: locationId,
      // Square emails the buyer its own receipt when given an address.
      ...(donorEmail ? { buyer_email_address: donorEmail } : {}),
      note: donorName ? `Meadowbrook DRA donation — ${donorName}` : 'Meadowbrook DRA donation',
    }),
  });

  const squareData = await squareRes.json();

  if (squareRes.ok && squareData.payment?.status === 'COMPLETED') {
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Log declines/failures so they're visible in Cloud Logging — the Square
  // error `code` is what tells us *why* (e.g. CARD_DECLINED_VERIFICATION_REQUIRED
  // means the buyer still needs SCA). We only log non-identifying fields.
  const squareError = squareData.errors?.[0];
  console.error('donate: payment not completed', {
    httpStatus: squareRes.status,
    amountPence,
    intent: intent.id,
    code: squareError?.code,
    category: squareError?.category,
    detail: squareError?.detail,
  });

  // Give SCA declines a clearer, actionable message than Square's raw string.
  const userMessage = squareError?.code === 'CARD_DECLINED_VERIFICATION_REQUIRED'
    ? 'Your bank needs to verify this payment. Please try again and complete the verification step, or use a different card.'
    : squareError?.detail ?? 'Payment failed. Please try again.';

  return new Response(
    JSON.stringify({ error: userMessage }),
    { status: squareRes.ok ? 500 : squareRes.status, headers: { 'Content-Type': 'application/json' } }
  );
};
