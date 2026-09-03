import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

// The booking form has a required tickbox reading "I agree to the room hire terms",
// linking to /room-hire-terms. That page did not exist for the first day the system
// was live: the link 404'd while real bookings recorded a termsVersion against terms
// nobody could read. Two things are pinned here so that cannot recur.

const TERMS_YAML = 'src/content/misc-pages/room-hire-terms.yaml';

/** Routes a link may resolve to: a page file, or a redirect declared in the config. */
function routeExists(path: string): boolean {
  const clean = path.replace(/^\//, '').replace(/\/$/, '');
  const candidates = [
    `src/pages/${clean}.astro`,
    `src/pages/${clean}/index.astro`,
    `src/pages/${clean}.ts`,
  ];
  if (candidates.some((c) => existsSync(c))) return true;
  // A dynamic segment: /bookings/find is a file, but /facilities/x is [slug].astro.
  const parts = clean.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = `src/pages/${parts.slice(0, i).join('/')}`.replace(/\/$/, '');
    if (existsSync(dir) && readdirSync(dir).some((f) => f.startsWith('[') && f.endsWith('.astro'))) return true;
  }
  const config = readFileSync('astro.config.mjs', 'utf8');
  return config.includes(`'${path}'`);
}

describe('room hire terms', () => {
  test('every internal link on the booking surfaces resolves to a real route', () => {
    const surfaces = [
      'src/components/BookingWidget.astro',
      'src/lib/booking/email.ts',
      'src/pages/bookings/[ref].astro',
      'src/pages/bookings/find.astro',
      'src/pages/book/[slug].astro',
    ].filter(existsSync);

    const broken: string[] = [];
    for (const file of surfaces) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/href="(\/[a-z0-9/-]*)"/g)) {
        if (!routeExists(m[1])) broken.push(`${file} links to ${m[1]}`);
      }
    }
    assert.deepEqual(broken, [], `Dead internal link(s):\n  ${broken.join('\n  ')}`);
  });

  test('the terms page exists and is reachable at /room-hire-terms', () => {
    assert.ok(existsSync('src/pages/room-hire-terms.astro'), 'the page itself is missing');
    assert.ok(existsSync(TERMS_YAML), 'the Keystatic entry is missing');
    assert.ok(existsSync('src/content/misc-pages/room-hire-terms/body.mdoc'), 'the terms body is missing');
  });

  // The version is stamped onto every booking so a dispute can be settled against
  // the terms as they stood that day. Two copies of it exist by necessity -- one the
  // page displays, one the API records -- and they are worthless if they disagree.
  test('the published version matches the one recorded against bookings', () => {
    const published = readFileSync(TERMS_YAML, 'utf8').match(/^version:\s*'?([^'\n]+)'?/m)?.[1]?.trim();
    const recorded = readFileSync('src/pages/api/booking/create.ts', 'utf8')
      .match(/TERMS_VERSION\s*=\s*'([^']+)'/)?.[1];

    assert.ok(published, `no version in ${TERMS_YAML}`);
    assert.ok(recorded, 'no TERMS_VERSION in create.ts');
    assert.equal(
      published, recorded,
      `The terms page publishes version ${published} but bookings record ${recorded}. `
      + 'Bump both together.',
    );
  });

  test('the terms cover what the booking flow actually promises', () => {
    const body = readFileSync('src/content/misc-pages/room-hire-terms/body.mdoc', 'utf8');
    for (const promise of ['1 hour', 'refund', 'door', 'privacy policy']) {
      assert.match(body.toLowerCase(), new RegExp(promise.toLowerCase()),
        `the terms never mention "${promise}", which the booking flow relies on`);
    }
  });
});
