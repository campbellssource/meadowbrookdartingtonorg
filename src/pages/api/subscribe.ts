import type { APIRoute } from 'astro';

const BREVO = 'https://api.brevo.com/v3';

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

/**
 * Name of the honeypot field. It is in the form, hidden from people, and any
 * request that fills it in is a bot.
 *
 * Ten bot sign-ups reached the list between June and August 2026 -- random
 * first name, no surname, a throwaway Gmail address with dots sprinkled through
 * it -- against three real ones in the same window. This catches the ones that
 * fill in every field they can find; double opt-in catches the rest, including
 * anything posting to this endpoint directly and never seeing the form.
 */
const HONEYPOT_FIELD = 'website';

/**
 * Read one variable from the runtime environment.
 *
 * The literal `import.meta.env.NAME` in the caller matters: Vite substitutes that
 * exact expression at build time, so it cannot be turned into a lookup by name.
 * And under plain node -- the test runner -- `import.meta.env` does not exist at
 * all, so reading a property off it throws. Hence a thunk and a try: the fallback
 * is evaluated only when needed, and its absence is a missing value rather than a
 * crash. Without this the "not configured" branch below is unreachable and
 * untestable, which is exactly the branch that must not go wrong.
 */
function env(fromProcess: string | undefined, fromMeta: () => unknown): string | undefined {
  if (fromProcess) return fromProcess;
  try {
    const value = fromMeta();
    return value == null || value === '' ? undefined : String(value);
  } catch {
    return undefined;
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type BrevoCall = { status: number; text: string };

async function brevo(path: string, apiKey: string, init?: RequestInit): Promise<BrevoCall> {
  const res = await fetch(`${BREVO}${path}`, {
    ...init,
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  // Read the body once: 204 carries none, errors carry a reason.
  const text = res.status === 204 ? '' : await res.text().catch(() => '');
  return { status: res.status, text };
}

/**
 * Send a call that carries attributes, dropping VOLUNTEER and trying again if
 * Brevo says it does not know the attribute. See VOLUNTEER_ATTRIBUTE above.
 */
async function withAttributeFallback(
  send: (attrs: Record<string, unknown>) => Promise<BrevoCall>,
  attributes: Record<string, unknown>,
  email: string,
): Promise<BrevoCall> {
  const result = await send(attributes);
  if (!(VOLUNTEER_ATTRIBUTE in attributes)) return result;
  if (result.status !== 400 || !/attribute/i.test(result.text)) return result;

  console.warn(
    `Brevo rejected the ${VOLUNTEER_ATTRIBUTE} attribute, so ${email} is being subscribed `
    + `without it. Create ${VOLUNTEER_ATTRIBUTE} as a boolean contact attribute in Brevo. `
    + `Response: ${result.text.slice(0, 200)}`,
  );
  const { [VOLUNTEER_ATTRIBUTE]: _dropped, ...rest } = attributes;
  return send(rest);
}

export const POST: APIRoute = async ({ request }) => {
  let email: string;
  let firstName: string;
  let lastName: string;
  let volunteer: boolean;
  let honeypot: string;

  try {
    const body = await request.json();
    email = (body.email ?? '').trim().toLowerCase();
    firstName = (body.firstName ?? '').trim();
    lastName = (body.lastName ?? '').trim();
    volunteer = body.volunteer === true;
    honeypot = (body[HONEYPOT_FIELD] ?? '').trim();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  // Answer a bot exactly as we answer a person, so it has nothing to learn from
  // the difference and no reason to come back and try another shape.
  if (honeypot) {
    console.warn(`Honeypot filled ("${honeypot.slice(0, 60)}"); dropping sign-up for ${email}.`);
    return json({ success: true, confirm: false }, 200);
  }

  const apiKey = env(process.env.BREVO_API_KEY, () => import.meta.env.BREVO_API_KEY);
  const listId = Number(env(process.env.BREVO_LIST_ID, () => import.meta.env.BREVO_LIST_ID));
  const doiTemplateId = Number(
    env(process.env.BREVO_DOI_TEMPLATE_ID, () => import.meta.env.BREVO_DOI_TEMPLATE_ID),
  );

  // Failing closed on a missing DOI template is deliberate. Quietly falling back
  // to adding contacts outright would put the list straight back to accepting
  // whatever a bot posts, and nothing would say so.
  if (!apiKey || !listId || !doiTemplateId) {
    if (apiKey && listId && !doiTemplateId) {
      console.error('BREVO_DOI_TEMPLATE_ID is not set; refusing to subscribe anyone '
        + 'rather than adding contacts without confirming the address.');
    }
    return json({ error: 'Server configuration error. Please try again later.' }, 500);
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }

  const attributes: Record<string, unknown> = {};
  if (firstName) attributes.FIRSTNAME = firstName;
  if (lastName) attributes.LASTNAME = lastName;
  if (volunteer) attributes[VOLUNTEER_ATTRIBUTE] = true;

  const existing = await brevo(`/contacts/${encodeURIComponent(email)}`, apiKey, { method: 'GET' });

  if (existing.status !== 404 && existing.status !== 200) {
    console.warn(`Brevo contact lookup failed: ${existing.status} ${existing.text.slice(0, 200)}`);
    return json({ error: 'Something went wrong. Please try again.' }, 502);
  }

  const result = existing.status === 200
    // Already in Brevo, so the address has been confirmed before. Sending them
    // round the double opt-in loop again would mean an existing subscriber who
    // volunteers stays unflagged until they fish a second email out of a spam
    // folder. Bots do not reuse addresses that are already on the list.
    ? await withAttributeFallback((attrs) => brevo('/contacts', apiKey, {
      method: 'POST',
      body: JSON.stringify({
        email,
        listIds: [listId],
        updateEnabled: true,
        ...(Object.keys(attrs).length ? { attributes: attrs } : {}),
      }),
    }), attributes, email)
    // New address: nothing is written to the list until they click the link in
    // the email Brevo sends. This is what makes a bot sign-up worthless.
    : await withAttributeFallback((attrs) => brevo('/contacts/doubleOptinConfirmation', apiKey, {
      method: 'POST',
      body: JSON.stringify({
        email,
        includeListIds: [listId],
        templateId: doiTemplateId,
        redirectionUrl: `${siteOrigin(request)}/subscribed`,
        ...(Object.keys(attrs).length ? { attributes: attrs } : {}),
      }),
    }), attributes, email);

  const confirm = existing.status === 404;

  // 201 created, 204 updated, 200 accepted for confirmation
  if ([200, 201, 204].includes(result.status)) {
    return json({ success: true, confirm }, 200);
  }

  let brevoError = 'Something went wrong. Please try again.';
  try {
    const errBody = JSON.parse(result.text);
    if (errBody?.message) brevoError = errBody.message;
  } catch { /* ignore */ }

  console.warn(`Brevo sign-up failed for ${email}: ${result.status} ${result.text.slice(0, 200)}`);
  return json({ error: brevoError }, result.status);
};

/**
 * Where Brevo sends someone after they click the confirmation link.
 *
 * Prefers the configured origin so the link is right no matter what host header
 * the request arrived with, and falls back to the request's own origin, which is
 * what makes this work on the dev server.
 */
function siteOrigin(request: Request): string {
  const configured = env(process.env.PUBLIC_SITE_ORIGIN, () => import.meta.env.PUBLIC_SITE_ORIGIN);
  if (configured) return configured.replace(/\/$/, '');
  return new URL(request.url).origin;
}
