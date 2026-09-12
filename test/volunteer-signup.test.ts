import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { POST } from '../src/pages/api/subscribe.ts';

// The volunteer sign-up form posts to the same endpoint as the newsletter form.
// The only thing separating a volunteer from a newsletter subscriber in Brevo is
// the VOLUNTEER attribute, so these tests are mostly about that one flag: that it
// is set when it should be, absent when it should not be, and that a Brevo account
// missing the attribute costs us the flag rather than the person.

const realFetch = globalThis.fetch;
let calls: { body: any }[] = [];

/** Stands in for Brevo. `replies` is consumed one call at a time. */
function stubBrevo(...replies: [number, unknown][]) {
  const queue = [...replies];
  globalThis.fetch = (async (_url: any, init: any = {}) => {
    calls.push({ body: init.body ? JSON.parse(init.body) : null });
    const [status, body] = queue.shift() ?? [500, { message: 'no stub left' }];
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
}

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
  // Both must be set: the route falls back to import.meta.env, which does not
  // exist under plain node, so an unset variable here throws rather than fails.
  process.env.BREVO_API_KEY = 'test-key';
  process.env.BREVO_LIST_ID = '2';
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('volunteer sign-up', () => {
  test('is flagged on the contact, on the ordinary newsletter list', async () => {
    stubBrevo([201, { id: 1 }]);
    const res = await post({
      email: 'Rosa@Example.com', firstName: 'Rosa', lastName: 'Vasquez', volunteer: true,
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, {
      email: 'rosa@example.com',
      listIds: [2],
      updateEnabled: true,
      attributes: { FIRSTNAME: 'Rosa', LASTNAME: 'Vasquez', VOLUNTEER: true },
    });
  });

  test('an existing contact is updated, not rejected', async () => {
    stubBrevo([204, null]);
    const res = await post({ email: 'rosa@example.com', volunteer: true });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true });
  });

  test('a plain newsletter sign-up is not marked as a volunteer', async () => {
    stubBrevo([201, { id: 2 }]);
    await post({ email: 'sam@example.com', firstName: 'Sam' });
    assert.deepEqual(calls[0].body.attributes, { FIRSTNAME: 'Sam' });
  });

  test('no name given means no attributes at all, rather than empty strings', async () => {
    stubBrevo([201, { id: 3 }]);
    await post({ email: 'sam@example.com' });
    assert.equal('attributes' in calls[0].body, false);
  });
});

describe('when Brevo has no VOLUNTEER attribute', () => {
  // Brevo rejects the whole contact if an attribute is unknown. Someone who
  // volunteered would get an error and, most likely, never come back -- so the
  // sign-up is retried without the flag.
  test('the person is still subscribed, without the flag', async () => {
    stubBrevo(
      [400, { code: 'invalid_parameter', message: 'Invalid attributes: VOLUNTEER' }],
      [201, { id: 4 }],
    );
    const res = await post({ email: 'rosa@example.com', firstName: 'Rosa', volunteer: true });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { success: true });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].body.attributes, { FIRSTNAME: 'Rosa' });
  });

  test('a 400 about anything else is not retried', async () => {
    stubBrevo([400, { message: 'Invalid email address' }]);
    const res = await post({ email: 'rosa@example.com', volunteer: true });

    assert.equal(calls.length, 1);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Invalid email address' });
  });

  test('a newsletter sign-up is never retried, having nothing to drop', async () => {
    stubBrevo([400, { message: 'Invalid attributes: FIRSTNAME' }]);
    const res = await post({ email: 'sam@example.com', firstName: 'Sam' });

    assert.equal(calls.length, 1);
    assert.equal(res.status, 400);
  });
});

describe('rejected before Brevo is troubled', () => {
  for (const email of ['', 'not-an-email', 'still@wrong']) {
    test(`"${email}" is refused locally`, async () => {
      stubBrevo([201, { id: 5 }]);
      const res = await post({ email });
      assert.equal(res.status, 400);
      assert.equal(calls.length, 0);
    });
  }
});

describe('the volunteer page carries the form', () => {
  const page = 'src/pages/volunteer.astro';

  test('the page exists and asks for the volunteer flag', () => {
    assert.ok(existsSync(page), `${page} is what /volunteer serves`);
    const src = readFileSync(page, 'utf8');
    assert.match(src, /<MailingListForm[\s\S]*?volunteer/,
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
    const src = readFileSync('src/pages/content/[slug].astro', 'utf8');
    assert.match(src, /slug !== 'volunteer'/,
      'otherwise /content/volunteer renders a second copy with no form on it');
  });
});
