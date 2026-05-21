import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.BREVO_API_KEY;
  const listId = Number(import.meta.env.BREVO_LIST_ID);

  if (!apiKey || !listId) {
    return new Response(
      JSON.stringify({ error: 'Server configuration error. Please try again later.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let email: string;
  let firstName: string;

  try {
    const body = await request.json();
    email = (body.email ?? '').trim().toLowerCase();
    firstName = (body.firstName ?? '').trim();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid request.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(
      JSON.stringify({ error: 'Please enter a valid email address.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const payload: Record<string, unknown> = {
    email,
    listIds: [listId],
    updateEnabled: true,
  };

  if (firstName) {
    payload.attributes = { FIRSTNAME: firstName };
  }

  const brevoRes = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  // 201 = created, 204 = already existed and updated
  if (brevoRes.status === 201 || brevoRes.status === 204) {
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Brevo returns error details in the body
  let brevoError = 'Something went wrong. Please try again.';
  try {
    const errBody = await brevoRes.json();
    if (errBody?.message) brevoError = errBody.message;
  } catch { /* ignore */ }

  return new Response(
    JSON.stringify({ error: brevoError }),
    { status: brevoRes.status, headers: { 'Content-Type': 'application/json' } }
  );
};
