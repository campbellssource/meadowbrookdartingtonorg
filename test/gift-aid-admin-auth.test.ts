import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { signSession, ADMIN_COOKIE } from '../src/lib/booking/admin-auth.ts';
import { POST } from '../src/pages/api/admin/gift-aid.ts';

// /admin/gift-aid holds donors' home addresses. It must be a real sign-in, not an
// unlisted URL: the API refuses before reading anything, the page redirects before
// touching the database, and nothing public links to it.

let prevSecret: string | undefined; let prevList: string | undefined;
before(() => {
  prevSecret = process.env.BOOKING_MAGIC_LINK_SECRET;
  prevList = process.env.BOOKING_ADMIN_EMAILS;
  process.env.BOOKING_MAGIC_LINK_SECRET = 'gift-aid-test-secret-at-least-32-bytes!';
  process.env.BOOKING_ADMIN_EMAILS = 'treasurer@meadowbrookdartington.org';
});
after(() => {
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('BOOKING_MAGIC_LINK_SECRET', prevSecret);
  restore('BOOKING_ADMIN_EMAILS', prevList);
});

function call(cookie: string | undefined, body: unknown) {
  let bodyRead = false;
  const request = {
    json: async () => { bodyRead = true; return body; },
  } as unknown as Request;
  const cookies = { get: (name: string) => (name === ADMIN_COOKIE && cookie ? { value: cookie } : undefined) };
  return {
    response: (POST as any)({ request, cookies }) as Promise<Response>,
    wasBodyRead: () => bodyRead,
  };
}

describe('the Gift Aid admin API', () => {
  test('no session: 401, and the body is never read', async () => {
    const c = call(undefined, { action: 'declaration', mode: 'paper', fields: {} });
    const res = await c.response;
    assert.equal(res.status, 401);
    assert.equal(c.wasBodyRead(), false);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(res.headers.get('cache-control'), 'no-store, private');
  });

  test('a forged or tampered cookie: 401', async () => {
    const valid = signSession('treasurer@meadowbrookdartington.org');
    for (const bad of ['garbage', `${valid.slice(0, -2)}xx`, signSession('attacker@evil.example')]) {
      const c = call(bad, { action: 'lookup' });
      assert.equal((await c.response).status, 401, bad.slice(0, 12));
      assert.equal(c.wasBodyRead(), false);
    }
  });

  test('an expired session: 401', async () => {
    const old = signSession('treasurer@meadowbrookdartington.org', new Date(Date.now() - 13 * 3600_000));
    assert.equal((await call(old, { action: 'lookup' }).response).status, 401);
  });

  test('removed from the allowlist: locked out on the next request', async () => {
    const s = signSession('treasurer@meadowbrookdartington.org');
    process.env.BOOKING_ADMIN_EMAILS = 'someone.else@meadowbrookdartington.org';
    assert.equal((await call(s, { action: 'lookup' }).response).status, 401);
    process.env.BOOKING_ADMIN_EMAILS = 'treasurer@meadowbrookdartington.org';
  });

  test('a valid session gets past the door (and is then validated as normal)', async () => {
    const s = signSession('treasurer@meadowbrookdartington.org');
    const c = call(s, { action: 'declaration', mode: 'paper', fields: { optIn: true } });
    const res = await c.response;
    assert.equal(res.status, 400, 'invalid fields, rejected before any database write');
    assert.equal(c.wasBodyRead(), true);
    const data = await res.json() as { fields: Record<string, string> };
    assert.ok(data.fields.postcode && data.fields.madeOn);
  });

  test('a valid session with an unknown action is refused', async () => {
    const s = signSession('treasurer@meadowbrookdartington.org');
    assert.equal((await call(s, { action: 'drop-tables' }).response).status, 400);
  });
});

describe('the Gift Aid admin page', () => {
  const page = readFileSync('src/pages/admin/gift-aid.astro', 'utf8');

  test('checks the session and redirects before reading any data', () => {
    const check = page.indexOf('verifySession(Astro.cookies.get(ADMIN_COOKIE)?.value)');
    const redirect = page.indexOf("return Astro.redirect('/admin/signin', 302)");
    const firstRead = page.indexOf('firestoreStore.');
    assert.ok(check > 0, 'the page must verify the mb_admin session');
    assert.ok(redirect > check, 'and redirect when it fails');
    assert.ok(firstRead > redirect, 'no database read may happen before the redirect');
  });

  test('is server-rendered, noindex and no-store', () => {
    assert.match(page, /export const prerender = false;/);
    assert.match(page, /noindex=\{true\}/);
    assert.match(page, /ADMIN_HEADERS\)\) Astro\.response\.headers\.set/);
  });

  test('is not linked from any public page', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) walk(full); else if (/\.(astro|ts|md|mdoc|yaml)$/.test(e)) files.push(full);
      }
    };
    walk('src');
    const offenders = files
      .filter((f) => !f.startsWith(join('src', 'pages', 'admin')) && !f.startsWith(join('src', 'pages', 'api', 'admin')))
      // A link, not a mention: the webhook's alert email may tell a person where to go.
      .filter((f) => /href=\{?["'`]\/admin\/gift-aid/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(offenders, [], 'public pages must not link to /admin/gift-aid');
  });

  test('tablet mode hides the navigation to other donors\' records', () => {
    assert.match(page, /<nav class="ga-tabs"[^>]*hidden=\{mode === 'tablet'\}/);
  });
});
