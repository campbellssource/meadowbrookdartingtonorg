#!/usr/bin/env node
/**
 * Creates upcoming Coffee Club event files if they don't already exist.
 *
 * Coffee Club is a weekly get-together for the over-55s, every Wednesday
 * 10:30am–12pm at Pizzalogica, Meadowbrook. This script keeps the next few
 * Wednesdays populated. Run it weekly via GitHub Actions.
 *
 * IMPORTANT — how to skip a week:
 *   Do NOT delete the event in the CMS. The only "already exists?" check here
 *   is whether the file is on disk, so a deleted week just gets recreated on
 *   the next run. Instead, open the event in the CMS and set its Status to
 *   "Cancelled" or "Hidden". The file stays on disk, so this script leaves it
 *   alone, and the site shows it correctly.
 *
 * Manual backfill (e.g. populate the next 6 Wednesdays):
 *   node scripts/create-coffee-club.mjs --weeks 6
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ── Config ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? parseInt(args[i + 1], 10) : null;
};
const WEEKS_AHEAD = flag('--weeks') ?? 3; // how many upcoming Wednesdays to keep

const WEEKDAY    = 3;          // 0=Sun … 3=Wed
const START_TIME = '10:30am';
const END_TIME   = '12pm';
const LOCATION   = 'Meadowbrook, Dartington';

// ── Date helpers ─────────────────────────────────────────────────────────────
function toDateStr(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// First Wednesday on or after today
const now      = new Date();
const today    = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const offset   = (WEEKDAY - today.getDay() + 7) % 7;
const firstWed = new Date(today);
firstWed.setDate(today.getDate() + offset);

const eventsDir = join(repoRoot, 'src/content/events');
let created = 0;

for (let i = 0; i < WEEKS_AHEAD; i++) {
  const d = new Date(firstWed);
  d.setDate(firstWed.getDate() + i * 7);

  const dateStr  = toDateStr(d);
  const slug     = `coffee-club-${dateStr}`;
  const yamlPath = join(eventsDir, `${slug}.yaml`);
  const bodyDir  = join(eventsDir, slug);
  const bodyPath = join(bodyDir, 'body.mdoc');

  // Idempotency: never overwrite an existing file. A week that's been marked
  // Cancelled/Hidden in the CMS still lives on disk, so it's left untouched.
  if (existsSync(yamlPath)) {
    console.log(`Already exists - skipping: ${slug}`);
    continue;
  }

  const niceDate = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const title    = `Coffee Club – ${niceDate}`;

  // ── Generate OG image ──────────────────────────────────────────────────────
  let imageFilename = null;
  try {
    const { generateSocialImage } = await import('./generate-social-image.mjs');
    imageFilename = await generateSocialImage({
      slug,
      title: 'Coffee Club',
      date: dateStr,
      time: START_TIME,
      cardOpts: {
        pill:    'OVER 55s · WEEKLY',
        eyebrow: 'COFFEE CLUB · MEADOWBROOK',
        where:   'Meadowbrook\nDartington',
      },
    });
  } catch (err) {
    console.warn(`Image generation skipped: ${err.message}`);
  }

  // ── Write YAML ─────────────────────────────────────────────────────────────
  const yaml = `title: '${title}'
date: '${dateStr}'
startTime: '${START_TIME}'
endTime: '${END_TIME}'
location: '${LOCATION}'
status: 'active'
summary: >-
  A weekly get-together for the over-55s. We meet at Meadowbrook, lend a hand
  with a few jobs around the site, play a few games (often boules) and share a
  coffee in the Community Café run by Bidwell Brook students.
${imageFilename ? `image: '${imageFilename}'\n` : ''}`;

  // ── Write body ─────────────────────────────────────────────────────────────
  const body = `Coffee Club is a relaxed weekly get-together for the over-55s.

We meet at **Meadowbrook**, lend a hand with a few jobs to help care for the site, play some games — often boules — and finish with a coffee in the Community Café run by students from [Bidwell Brook School](https://www.bidwellbrook.devon.sch.uk), in partnership with [Pizzalogica](https://pizzalogica.uk).

All welcome. Come for the jobs, the games, or just the coffee and company.

---

Coffee Club runs **every Wednesday from 10:30am to 12pm** at Meadowbrook. Just occasionally a week is off — if you're not sure, ask us on [Facebook](https://www.facebook.com/meadowbrookdartington) or [Instagram](https://www.instagram.com/meadowbrookdartington/) and we'll let you know.
`;

  mkdirSync(bodyDir, { recursive: true });
  writeFileSync(yamlPath, yaml);
  writeFileSync(bodyPath, body);

  console.log(`Created: ${slug} - ${dateStr}`);
  created++;
}

console.log(`Done. Created ${created} new Coffee Club event(s).`);
