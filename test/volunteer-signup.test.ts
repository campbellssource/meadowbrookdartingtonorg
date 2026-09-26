import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { POST } from '../src/pages/api/subscribe.ts';

// Sign-ups. Both forms post here; what varies is the VOLUNTEER attribute, which is
// the only thing separating a volunteer from a newsletter subscriber in Brevo.
//
// The rest of this file is about keeping bots off the list. Between June and August
// 2026 ten of the thirteen sign-ups were bots -- random first name, no surname, a
// throwaway Gmail address with dots sprinkled through it. The honeypot stops the
// ones that fill in every field; double opt-in stops everything else, because an
// address that is never confirmed never reaches the list at all.

const realFetch = globalThis.fetch;
let calls: { path: string; method: string; body: any }[] = [];

/** Stands in for Brevo. `routes` maps "METHOD /path" to a [status, body] pair. */
function stubBrevo(routes: Record<string, [number, unknown]>) {
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const path = String(url).replace('https://api.brevo.com/v3', '');
    const method = init.method ?? 'GET';
    calls.push({ path, method, body: init.body ? JSON.parse(init.body) : null });
    const hit = routes[`${method} ${path}`];
    if (!hit) return new Response('no stub', { status: 500 });
    const bodyless = [204, 205, 304].includes(hit[0]);
    return new Response(bodyless ? null : JSON.stringify(hit[1]), { status: hit[0] });
  }) as typeof fetch;
}

const KNOWN = 'GET /contacts/rosa%40example.com';
const UNKNOWN: [number, unknown] = [404, { code: 'document_not_found' }];

function post(body: unknown): Promise<Response> {
  const request = new Request('https://meadowbrookdartington.org/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST({ request } as any) as Promise<Response>;
}

beforeEach(() => {
  calls = [];
  // All three must be set: the route falls back to import.meta.env, which does
  // not exist under plain node, so an unset variable throws rather than fails.
  process.env.BREVO_API_KEY = 'test-key';
  process.env.BREVO_LIST_ID = '2';
  process.env.BREVO_DOI_TEMPLATE_ID = '7';
  process.env.PUBLIC_SITE_ORIGIN = 'https://meadowbrookdartington.org';
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('a new address', () => {
  test('is sent round double opt-in, not added to the list', async () => {
    stubBrevo({
      [KNOWN]: UNKNOWN,
      'POST /contacts/doubleOptinConfirmation': [201, {}],
    });
    const res = await post({
      email: 'Rosa@Example.com', firstName: 'Rosa', lastName: 'Vasquez', volunteer: true,
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, confirm: true });
    assert.deepEqual(calls.map((c) => c.path), ['/contacts/rosa%40example.com',
      '/contacts/doubleOptinConfirmation']);
    assert.deepEqual(calls[1].body, {
      email: 'rosa@example.com',
      includeListIds: [2],
      templateId: 7,
      redirectionUrl: 'https://meadowbrookdartington.org/subscribed',
      attributes: { FIRSTNAME: 'Rosa', LASTNAME: 'Vasquez', VOLUNTEER: true },
    });
  });

  test('is never written to the list by this request', async () => {
    stubBrevo({ [KNOWN]: UNKNOWN, 'POST /contacts/doubleOptinConfirmation': [201, {}] });
    await post({ email: 'rosa@example.com' });
    assert.equal(calls.some((c) => c.method === 'POST' && c.path === '/contacts'), false,
      'a bot sign-up must be worthless until the address is confirmed');
  });
});

describe('an address Brevo already knows', () => {
  // Sending an existing subscriber round the loop again would leave someone who
  // volunteers unflagged until they fish a second email out of a spam folder.
  test('is updated directly, and told so', async () => {
    stubBrevo({ [KNOWN]: [200, { id: 1, listIds: [2] }], 'POST /contacts': [204, null] });
    const res = await post({ email: 'rosa@example.com', firstName: 'Rosa', volunteer: true });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true, confirm: false });
    assert.deepEqual(calls[1].body, {
      email: 'rosa@example.com',
      listIds: [2],
      updateEnabled: true,
      attributes: { FIRSTNAME: 'Rosa', VOLUNTEER: true },
    });
  });

  test('a plain newsletter sign-up is not marked as a volunteer', async () => {
    stubBrevo({ [KNOWN]: [200, { id: 1 }], 'POST /contacts': [204, null] });
    await post({ email: 'rosa@example.com', firstName: 'Rosa' });
    assert.deepEqual(calls[1].body.attributes, { FIRSTNAME: 'Rosa' });
  });

  test('no name given means no attributes at all, rather than empty strings', async () => {
    stubBrevo({ [KNOWN]: [200, { id: 1 }], 'POST /contacts': [204, null] });
    await post({ email: 'rosa@example.com' });
    assert.equal('attributes' in calls[1].body, false);
  });
});

describe('the honeypot', () => {
  test('a filled hidden field is dropped without troubling Brevo', async () => {
    stubBrevo({ [KNOWN]: UNKNOWN, 'POST /contacts/doubleOptinConfirmation': [201, {}] });
    const res = await post({ email: 'rosa@example.com', website: 'http://buy-pills.example' });

    assert.equal(calls.length, 0, 'nothing should reach Brevo');
    assert.equal(res.status, 200);
  });

  test('looks exactly like success, so a bot learns nothing from the difference', async () => {
    stubBrevo({ [KNOWN]: [200, { id: 1 }], 'POST /contacts': [204, null] });
    const trapped = await post({ email: 'rosa@example.com', website: 'spam' });
    calls = [];
    const real = await post({ email: 'rosa@example.com' });

    assert.equal(trapped.status, real.status);
    assert.deepEqual(await trapped.json(), await real.json());
  });

  test('an empty hidden field is what a person sends, and passes', async () => {
    stubBrevo({ [KNOWN]: UNKNOWN, 'POST /contacts/doubleOptinConfirmation': [201, {}] });
    const res = await post({ email: 'rosa@example.com', website: '' });
    assert.deepEqual(await res.json(), { success: true, confirm: true });
  });
});

describe('when Brevo has no VOLUNTEER attribute', () => {
  // Brevo rejects the whole contact if an attribute is unknown. Someone who
  // volunteered would get an error and, most likely, never come back.
  test('an existing contact is still subscribed, without the flag', async () => {
    let seen = 0;
    globalThis.fetch = (async (url: any, init: any = {}) => {
      const path = String(url).replace('https://api.brevo.com/v3', '');
      calls.push({ path, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
      if (path.startsWith('/contacts/rosa')) return new Response(JSON.stringify({ id: 1 }), { status: 200 });
      seen += 1;
      return seen === 1
        ? new Response(JSON.stringify({ message: 'Invalid attributes: VOLUNTEER' }), { status: 400 })
        : new Response(null, { status: 204 });
    }) as typeof fetch;

    const res = await post({ email: 'rosa@example.com', firstName: 'Rosa', volunteer: true });
    assert.deepEqual(await res.json(), { success: true, confirm: false });
    assert.deepEqual(calls[2].body.attributes, { FIRSTNAME: 'Rosa' });
  });

  test('a 400 about anything else is not retried', async () => {
    stubBrevo({ [KNOWN]: [200, { id: 1 }], 'POST /contacts': [400, { message: 'Invalid email address' }] });
    const res = await post({ email: 'rosa@example.com', volunteer: true });

    assert.equal(calls.length, 2);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Invalid email address' });
  });
});

describe('refusing to work rather than working unsafely', () => {
  test('no DOI template means no sign-ups at all', async () => {
    delete process.env.BREVO_DOI_TEMPLATE_ID;
    stubBrevo({ [KNOWN]: UNKNOWN, 'POST /contacts/doubleOptinConfirmation': [201, {}] });
    const res = await post({ email: 'rosa@example.com' });

    assert.equal(res.status, 500);
    assert.equal(calls.length, 0,
      'falling back to adding contacts unconfirmed would reopen the list to bots');
  });

  test('a failed lookup does not guess', async () => {
    stubBrevo({ [KNOWN]: [503, { message: 'upstream boom' }] });
    const res = await post({ email: 'rosa@example.com' });
    assert.equal(res.status, 502);
    assert.equal(calls.length, 1);
  });
});

describe('rejected before Brevo is troubled', () => {
  for (const email of ['', 'not-an-email', 'still@wrong']) {
    test(`"${email}" is refused locally`, async () => {
      stubBrevo({ [KNOWN]: UNKNOWN });
      const res = await post({ email });
      assert.equal(res.status, 400);
      assert.equal(calls.length, 0);
    });
  }
});

describe('the pages that carry the form', () => {
  test('the volunteer page exists and asks for the volunteer flag', () => {
    const page = 'src/pages/volunteer.astro';
    assert.ok(existsSync(page), `${page} is what /volunteer serves`);
    assert.match(readFileSync(page, 'utf8'), /<MailingListForm[\s\S]*?volunteer/,
      'the form must be passed `volunteer`, or sign-ups arrive in Brevo unmarked');
  });

  test('/volunteer is not redirected away from the page that has the form', () => {
    const config = readFileSync('astro.config.mjs', 'utf8');
    assert.doesNotMatch(config, /'\/volunteer':/,
      "/volunteer is a real page now; a redirect would send people to the form-less copy");
    assert.match(config, /'\/content\/volunteer': '\/volunteer'/,
      'the old /content/volunteer URL is linked from event pages and must still work');
  });

  test('the generic content route no longer serves volunteer', () => {
    assert.match(readFileSync('src/pages/content/[slug].astro', 'utf8'), /slug !== 'volunteer'/,
      'otherwise /content/volunteer renders a second copy with no form on it');
  });

  test('the form carries the honeypot the endpoint checks', () => {
    const form = readFileSync('src/components/MailingListForm.astro', 'utf8');
    assert.match(form, /name="website"/, 'the honeypot field must be in the markup');
    assert.match(form, /website: value\('website'\)/, 'and must be sent with the sign-up');
    assert.match(readFileSync('src/pages/api/subscribe.ts', 'utf8'),
      /HONEYPOT_FIELD = 'website'/, 'and the endpoint must check that same field');
  });

  test('the double opt-in landing page exists', () => {
    assert.ok(existsSync('src/pages/subscribed.astro'),
      'Brevo redirects to /subscribed after someone confirms; a 404 there looks like failure');
  });
});
