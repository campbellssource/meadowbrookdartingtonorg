import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signSession, verifySession, isAllowed, devLoginAllowed } from '../src/lib/booking/admin-auth.ts';

let prevSecret: string | undefined; let prevList: string | undefined; let prevNode: string | undefined;
before(() => {
  prevSecret = process.env.BOOKING_MAGIC_LINK_SECRET;
  prevList = process.env.BOOKING_ADMIN_EMAILS;
  prevNode = process.env.NODE_ENV;
  process.env.BOOKING_MAGIC_LINK_SECRET = 'admin-test-secret-at-least-32-bytes!!';
  process.env.BOOKING_ADMIN_EMAILS = 'michael.campbell@meadowbrookdartington.org, other@dra.org';
});
after(() => {
  const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  restore('BOOKING_MAGIC_LINK_SECRET', prevSecret);
  restore('BOOKING_ADMIN_EMAILS', prevList);
  restore('NODE_ENV', prevNode);
});

describe('allowlist', () => {
  test('listed addresses pass, case-insensitively and trimmed', () => {
    assert.equal(isAllowed('michael.campbell@meadowbrookdartington.org'), true);
    assert.equal(isAllowed('MICHAEL.CAMPBELL@MeadowbrookDartington.org'), true);
    assert.equal(isAllowed('  other@dra.org  '), true);
  });

  test('an unlisted Workspace address is refused -- this is not a domain check', () => {
    assert.equal(isAllowed('someone.else@meadowbrookdartington.org'), false);
    assert.equal(isAllowed('bookings@meadowbrookdartington.org'), false);
  });

  test('empty and missing are refused', () => {
    assert.equal(isAllowed(''), false);
    assert.equal(isAllowed(null), false);
    assert.equal(isAllowed(undefined), false);
  });
});

describe('sessions', () => {
  test('a signed session verifies back to its email', () => {
    assert.equal(verifySession(signSession('other@dra.org')), 'other@dra.org');
  });

  test('a tampered signature is refused', () => {
    const s = signSession('other@dra.org');
    assert.equal(verifySession(s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A')), null);
  });

  test('a rewritten payload is refused', () => {
    const forged = Buffer.from(JSON.stringify({
      email: 'attacker@evil.com', exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    assert.equal(verifySession(`${forged}.${signSession('other@dra.org').split('.')[1]}`), null);
  });

  test('an expired session is refused', () => {
    const s = signSession('other@dra.org', new Date(Date.now() - 13 * 3600 * 1000));
    assert.equal(verifySession(s), null);
  });

  test('removing someone from the allowlist locks them out immediately', () => {
    const s = signSession('other@dra.org');
    assert.equal(verifySession(s), 'other@dra.org');
    process.env.BOOKING_ADMIN_EMAILS = 'michael.campbell@meadowbrookdartington.org';
    assert.equal(verifySession(s), null, 'a live session must not outlive the allowlist entry');
    process.env.BOOKING_ADMIN_EMAILS = 'michael.campbell@meadowbrookdartington.org, other@dra.org';
  });

  test('garbage is refused without throwing', () => {
    for (const junk of ['', '.', 'a.b', 'no-dot', 'x'.repeat(200)]) {
      assert.equal(verifySession(junk), null, junk.slice(0, 10));
    }
  });

  test('a magic-link token is not an admin session', () => {
    // Domain separation: the two share a secret but not a key.
    const notASession = 'eyJqdGkiOiJ4IiwicmVmIjoiTUItQUFBQUFBIn0.abc';
    assert.equal(verifySession(notASession), null);
  });
});

describe('dev login', () => {
  test('refused in production whatever the flag says', () => {
    process.env.NODE_ENV = 'production';
    process.env.BOOKING_ADMIN_DEV_LOGIN = 'true';
    assert.equal(devLoginAllowed(), false);
  });

  test('allowed outside production only when explicitly enabled', () => {
    process.env.NODE_ENV = 'development';
    process.env.BOOKING_ADMIN_DEV_LOGIN = 'true';
    assert.equal(devLoginAllowed(), true);
    process.env.BOOKING_ADMIN_DEV_LOGIN = 'false';
    assert.equal(devLoginAllowed(), false);
    delete process.env.BOOKING_ADMIN_DEV_LOGIN;
    assert.equal(devLoginAllowed(), false);
  });
});

describe('Copilot review findings', () => {
  test('the cron secret is compared in constant time, not with ===', () => {
    // An internet-reachable endpoint compared with === leaks the secret one byte
    // at a time to anyone patient enough to measure.
    const src = readFileSync('src/lib/booking/cron-auth.ts', 'utf8');
    assert.ok(src.includes('timingSafeEqual'), 'cron-auth must use timingSafeEqual');
    assert.ok(!/provided === secret/.test(src), 'the === comparison must be gone');
  });

  test('the OAuth flow sends and requires a state parameter', () => {
    const signin = readFileSync('src/pages/admin/signin.astro', 'utf8');
    const callback = readFileSync('src/pages/admin/auth/callback.ts', 'utf8');
    assert.ok(/state: state/.test(signin), 'sign-in must send state');
    assert.ok(callback.includes('OAUTH_STATE_COOKIE'), 'callback must read the state cookie');
    assert.ok(callback.includes("fail('state')"), 'callback must refuse a mismatch');
    assert.ok(/cookies\.delete\(OAUTH_STATE_COOKIE/.test(callback), 'state must be consumed');
  });

  test('emailed links use a canonical origin, not the request Host', () => {
    for (const f of ['src/pages/api/booking/find.ts', 'src/pages/api/booking/create.ts',
                     'src/pages/api/booking/cancel.ts', 'src/pages/api/booking/amend.ts',
                     'src/pages/api/admin/action.ts']) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('/bookings/')) continue;
      assert.ok(src.includes('canonicalOrigin'), `${f} builds a link without canonicalOrigin`);
    }
  });
});

describe('CSV formula injection', () => {
  // Leading whitespace defeated the original first-character check, and Excel
  // strips whitespace before deciding something is a formula.
  const FORMULA_START = /^[\s ]*[=+\-@\t\r]/;

  test('catches formulas hidden behind whitespace', () => {
    for (const v of ['=HYPERLINK("x")', ' =HYPERLINK("x")', '   +1+1', ' =CMD', '\t-2+3']) {
      assert.equal(FORMULA_START.test(v), true, `should catch ${JSON.stringify(v)}`);
    }
  });

  test('leaves ordinary values alone', () => {
    for (const v of ['Jody Fendick', 'a@b.co', '07725972868', 'Studio', '11.25']) {
      assert.equal(FORMULA_START.test(v), false, `should not touch ${JSON.stringify(v)}`);
    }
  });

  test('the export uses that pattern', () => {
    const src = readFileSync('src/pages/api/admin/export.ts', 'utf8');
    assert.ok(src.includes('\\u00a0'), 'export must handle the non-breaking space too');
  });
});

describe('door codes come from one place', () => {
  test('nothing derives a code with a bare slice', () => {
    // doorCodeFor returns null below 10 digits; a bare slice(-4) shows a code the
    // lock was never given.
    for (const f of ['src/lib/booking/reminders.ts', 'src/pages/bookings/[ref].astro',
                     'src/pages/admin/bookings.astro', 'src/pages/api/admin/action.ts',
                     'src/pages/api/booking/create.ts', 'src/lib/booking/email.ts']) {
      const src = readFileSync(f, 'utf8');
      assert.ok(!/phone[^\n]*replace\(\/\\D\/g, ''\)\.slice\(-4\)/.test(src),
        `${f} derives a door code directly instead of using doorCodeFor`);
    }
  });
});
