import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// An Astro <script> placed inside a {condition && (...)} expression is silently
// dropped: Astro compiles <script> tags in static template position only, so
// inside an expression the tag never reaches the output at all. No build error,
// no console message -- the page simply does nothing when clicked. Hit while
// building the booking manage page.
//
// Deliberately NOT checked here: scripts placed after </Layout>, which are emitted
// after </html>. That looks alarming and is untidy, but browsers relocate such
// nodes into the body and the scripts do run -- `src/pages/donate.astro` has been
// live in production that way. It was briefly mistaken for the cause of a card
// form failure whose real cause was Square refusing to load on 127.0.0.1.

function astroFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...astroFiles(full));
    else if (entry.endsWith('.astro')) out.push(full);
  }
  return out;
}

const files = astroFiles('src/pages');

describe('Astro script placement', () => {
  test('there are pages to check', () => {
    assert.ok(files.length > 5, `expected several .astro pages, found ${files.length}`);
  });

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const closeLayout = src.lastIndexOf('</Layout>');
    if (closeLayout === -1) continue;

    test(`${file}: no script inside a conditional expression`, () => {
      // Look for a script tag that sits between `&& (` or `? (` and its `)}`.
      const body = src.slice(0, closeLayout);
      const bad: string[] = [];
      for (const m of body.matchAll(/<script[^>]*>/g)) {
        const before = body.slice(0, m.index);
        // Count unclosed `(` opened by a JSX-ish conditional before this point.
        const opens = (before.match(/(?:&&|\?)\s*\(\s*\n/g) ?? []).length;
        const closes = (before.match(/^\s*\)\}/gm) ?? []).length;
        if (opens > closes) bad.push(m[0]);
      }
      assert.deepEqual(bad, [],
        `${file} has a <script> inside a conditional expression. Astro will not compile it. `
        + 'Render it unconditionally and guard in JavaScript instead.');
    });
  }
});
