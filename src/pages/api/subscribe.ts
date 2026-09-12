import type { APIRoute } from 'astro';

const BREVO_CONTACTS = 'https://api.brevo.com/v3/contacts';

/**
 * Brevo contact attribute marking someone who signed up on the volunteer page.
 *
 * Everyone goes onto the same list; this is what separates "wants the newsletter"
 * from "offered to help". It has to exist in the Brevo account as a boolean
 * contact attribute named VOLUNTEER (Contacts → Settings → Contact attributes).
 * Brevo rejects the entire request when an attribute is unknown, which would turn
 * a missing bit of account setup into a lost sign-up -- so a rejection that names
 * an attribute is retried without it. Losing the flag beats losing the volunteer.
 */
const VOLUNTEER_ATTRIBUTE = 'VOLUNTEER';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** One call to Brevo, with the body read once: 204 carries none, errors carry a reason. */
async function createContact(
  payload: Record<string, unknown>,
  apiKey: string,
): Promise<{ status: number; text: string }> {
  const res = await fetch(BREVO_CONTACTS, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = res.status === 204 ? '' : await res.text().catch(() => '');
  return { status: res.status, text };
}

export const POST: APIRoute = async ({ request }) => {
  const apiKey = process.env.BREVO_API_KEY ?? import.meta.env.BREVO_API_KEY;
  const listId = Number(process.env.BREVO_LIST_ID ?? import.meta.env.BREVO_LIST_ID);

  if (!apiKey || !listId) {
    return json({ error: 'Server configuration error. Please try again later.' }, 500);
  }

  let email: string;
  let firstName: string;
  let lastName: string;
  let volunteer: boolean;

  try {
    const body = await request.json();
    email = (body.email ?? '').trim().toLowerCase();
    firstName = (body.firstName ?? '').trim();
    lastName = (body.lastName ?? '').trim();
    volunteer = body.volunteer === true;
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }

  const attributes: Record<string, unknown> = {};
  if (firstName) attributes.FIRSTNAME = firstName;
  if (lastName) attributes.LASTNAME = lastName;
  if (volunteer) attributes[VOLUNTEER_ATTRIBUTE] = true;

  const payload = (attrs: Record<string, unknown>): Record<string, unknown> => ({
    email,
    listIds: [listId],
    updateEnabled: true,
    ...(Object.keys(attrs).length ? { attributes: attrs } : {}),
  });

  let result = await createContact(payload(attributes), apiKey);

  if (volunteer && result.status === 400 && /attribute/i.test(result.text)) {
    console.warn(
      `Brevo rejected the ${VOLUNTEER_ATTRIBUTE} attribute, so ${email} is being subscribed `
      + `without it. Create ${VOLUNTEER_ATTRIBUTE} as a boolean contact attribute in Brevo. `
      + `Response: ${result.text.slice(0, 200)}`,
    );
    const { [VOLUNTEER_ATTRIBUTE]: _dropped, ...rest } = attributes;
    result = await createContact(payload(rest), apiKey);
  }

  // 201 = created, 204 = already existed and updated
  if (result.status === 201 || result.status === 204) {
    return json({ success: true }, 200);
  }

  // Brevo returns error details in the body
  let brevoError = 'Something went wrong. Please try again.';
  try {
    const errBody = JSON.parse(result.text);
    if (errBody?.message) brevoError = errBody.message;
  } catch { /* ignore */ }

  return json({ error: brevoError }, result.status);
};
