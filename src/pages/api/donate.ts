import type { APIRoute } from 'astro';
import { randomUUID } from 'crypto';

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

  try {
    const body = await request.json();
    sourceId = (body.sourceId ?? '').trim();
    amountPence = Math.round(Number(body.amount));
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
      source_id: sourceId,
      idempotency_key: randomUUID(),
      amount_money: {
        amount: amountPence,
        currency: 'GBP',
      },
      location_id: locationId,
      note: 'Meadowbrook DRA donation',
    }),
  });

  const squareData = await squareRes.json();

  if (squareRes.ok && squareData.payment?.status === 'COMPLETED') {
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const errorDetail = squareData.errors?.[0]?.detail ?? 'Payment failed. Please try again.';
  return new Response(
    JSON.stringify({ error: errorDetail }),
    { status: squareRes.ok ? 500 : squareRes.status, headers: { 'Content-Type': 'application/json' } }
  );
};
