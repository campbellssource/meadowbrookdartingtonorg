import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

// A prerendered page has its frontmatter evaluated during `npm run build`, not per
// request. So any runtime value it reads -- an env var above all -- is frozen at
// build time. In CI the booking secrets are deliberately absent, so a prerendered
// page reading them bakes `undefined` into static HTML and serves it forever.
//
// This is exactly what happened on 2 Sep 2026. `/facilities/[slug]` was
// `prerender = true` and embedded BookingWidget, so the live page shipped
//
//     const squareAppId = undefined;
//
// and Square's SDK failed with "undefined is not an object (evaluating 'e.length')".
// Payments were down on a live site. Nothing warned: the build succeeded, the deploy
// succeeded, the Cloud Run revision genuinely had the right variables set, and
// `/book/[slug]` -- the same widget on an SSR page -- worked perfectly throughout.
//
// The check follows component imports, because the page that broke never mentioned
// an env var itself; it imported something that did.

function astroFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...astroFiles(full));
    else if (entry.endsWith('.astro')) out.push(full);
  }
  return out;
}

// import.meta.env exposes these at build time by design; they are not runtime config.
const VITE_BUILTINS = new Set(['MODE', 'DEV', 'PROD', 'BASE_URL', 'SSR', 'ASSETS_PREFIX']);

function readsRuntimeEnv(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/(?:process|import\.meta)\.env\.([A-Z0-9_]+)/g)) {
    if (!VITE_BUILTINS.has(m[1])) found.add(m[1]);
  }
  // the env() helper in src/lib/booking/env.ts, whose whole purpose is a runtime read
  for (const m of source.matchAll(/\benv\(\s*['"]([A-Z0-9_]+)['"]/g)) found.add(m[1]);
  return [...found];
}

/** Local .astro files a file imports, resolved to paths. */
function astroImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of source.matchAll(/^\s*import\s+\w+\s+from\s+['"](\.[^'"]+\.astro)['"]/gm)) {
    const target = resolve(dirname(file), m[1]);
    if (existsSync(target)) out.push(target);
  }
  return out;
}

/** Env vars a page reads, following its component imports. */
function envReachableFrom(entry: string): Map<string, string> {
  const hits = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const name of readsRuntimeEnv(readFileSync(file, 'utf8'))) {
      if (!hits.has(name)) hits.set(name, file);
    }
    queue.push(...astroImports(file));
  }
  return hits;
}

const pages = astroFiles('src/pages');
const prerendered = pages.filter((f) => /export\s+const\s+prerender\s*=\s*true/.test(readFileSync(f, 'utf8')));

describe('prerendered pages and runtime env', () => {
  test('no prerendered page reads a runtime env var, directly or through a component', () => {
    const offenders: string[] = [];
    for (const page of prerendered) {
      for (const [name, where] of envReachableFrom(page)) {
        offenders.push(
          where === page ? `${page} reads ${name}` : `${page} reads ${name} via ${where}`,
        );
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'A prerendered page reads an env var, so the value is whatever CI had at build time --\n' +
        'which for booking config is nothing. Either drop `prerender = true` from the page, or\n' +
        'fetch the value at runtime from an API route. Offenders:\n  ' +
        offenders.join('\n  '),
    );
  });

  test('the facility page, which embeds the booking widget, is not prerendered', () => {
    const page = 'src/pages/facilities/[slug].astro';
    const source = readFileSync(page, 'utf8');
    assert.match(source, /BookingWidget/, 'expected the facility page to embed BookingWidget');
    assert.doesNotMatch(
      source,
      /export\s+const\s+prerender\s*=\s*true/,
      `${page} must stay server-rendered: it embeds the Square payment form, whose ` +
        'application ID only exists at runtime.',
    );
  });
});
