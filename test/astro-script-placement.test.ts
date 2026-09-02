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

// A scoped Astro style targeting an element built at runtime silently matches
// nothing: the rule compiles to `.thing[data-astro-cid-x]` and innerHTML-created
// elements never carry that attribute. No error, no warning — the element is just
// unstyled, which is how a selected state can look identical to an unselected one.
//
// The fix is to anchor the rule to a container that IS in the template and mark
// the child :global(). This test looks for class names that appear in a template
// literal inside a <script> and also as a bare scoped selector in <style>.
describe('scoped styles do not target runtime-created elements', () => {
  const pages = astroFiles('src/pages').concat(astroFiles('src/components'));

  for (const file of pages) {
    const src = readFileSync(file, 'utf8');
    const scriptBlocks = [...src.matchAll(/<script[\s\S]*?<\/script>/g)].map((m) => m[0]).join('\n');
    const styleBlocks = [...src.matchAll(/<style[\s\S]*?<\/style>/g)].map((m) => m[0]).join('\n');
    if (!scriptBlocks || !styleBlocks) continue;

    test(`${file}: no scoped rule for a class only created in JS`, () => {
      // Classes the script writes into markup, e.g. class="bw-day is-sel"
      const built = new Set<string>();
      for (const m of scriptBlocks.matchAll(/class="([^"$]+)"/g)) {
        for (const c of m[1].split(/\s+/)) if (c && !c.includes('{')) built.add(c);
      }
      const offenders: string[] = [];
      for (const cls of built) {
        // A bare scoped selector: `.cls {` or `.cls.mod {` at the start of a rule,
        // not preceded by a descendant combinator and not inside :global().
        const bare = new RegExp(`(^|[},])\\s*\\.${cls}(\\.[\\w-]+)*\\s*(,|\\{)`, 'm');
        const globalised = new RegExp(`:global\\([^)]*\\.${cls}`);
        if (bare.test(styleBlocks) && !globalised.test(styleBlocks)) offenders.push(cls);
      }
      assert.deepEqual(offenders, [],
        `${file} styles .${offenders.join(', .')} with a scoped selector, but those elements are `
        + 'created at runtime and will not carry data-astro-cid-*. Anchor the rule to a template '
        + 'element and mark the child :global().');
    });
  }
});
