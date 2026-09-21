#!/usr/bin/env node
/**
 * Creates upcoming Fitness on the Field event files if they don't already exist.
 *
 * Fitness on the Field is a weekly outdoor fitness session for women run by
 * Tiny Feet Yoga, every Thursday 9:15–10am on the playing field at Meadowbrook.
 * This script keeps the next few Thursdays populated. Run it weekly via
 * GitHub Actions.
 *
 * Unlike Coffee Club and the DRA Social, this one does not generate a card per
 * week — every occurrence reuses the poster-derived hero at
 * public/images/events/fitness-on-the-field/image.jpg (a 1200×630 composite of
 * the Tiny Feet Yoga flyer, kept alongside it as flyer.jpg).
 *
 * IMPORTANT — how to skip a week:
 *   Do NOT delete the event in the CMS. The only "already exists?" check here
 *   is whether the file is on disk, so a deleted week just gets recreated on
 *   the next run. Instead, open the event in the CMS and set its Status to
 *   "Cancelled" or "Hidden". The file stays on disk, so this script leaves it
 *   alone, and the site shows it correctly.
 *
 * Manual backfill (e.g. populate the next 6 Thursdays):
 *   node scripts/create-fitness-on-the-field.mjs --weeks 6
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
const WEEKS_AHEAD = flag('--weeks') ?? 3; // how many upcoming Thursdays to keep

const WEEKDAY    = 4;          // 0=Sun … 4=Thu
const START_TIME = '9:15am';
const END_TIME   = '10am';
const LOCATION   = 'Meadowbrook Playing Field, Dartington';
const IMAGE      = '/images/events/fitness-on-the-field/image.jpg';
const ORGANISER  = 'https://www.tinyfeetyoga.co.uk';

// ── Date helpers ─────────────────────────────────────────────────────────────
function toDateStr(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// First Thursday on or after today
const now      = new Date();
const today    = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const offset   = (WEEKDAY - today.getDay() + 7) % 7;
const firstThu = new Date(today);
firstThu.setDate(today.getDate() + offset);

const eventsDir = join(repoRoot, 'src/content/events');
let created = 0;

for (let i = 0; i < WEEKS_AHEAD; i++) {
  const d = new Date(firstThu);
  d.setDate(firstThu.getDate() + i * 7);

  const dateStr  = toDateStr(d);
  const slug     = `fitness-on-the-field-${dateStr}`;
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
  const title    = `Fitness on the Field – ${niceDate}`;

  // ── Write YAML ─────────────────────────────────────────────────────────────
  const yaml = `title: '${title}'
date: '${dateStr}'
startTime: '${START_TIME}'
endTime: '${END_TIME}'
location: '${LOCATION}'
status: 'active'
summary: >-
  Outdoor fitness for women on the playing field at Meadowbrook. All ages and
  all abilities, in a friendly, supportive group - little ones welcome, and
  suitable from five months postpartum. Run by Tiny Feet Yoga.
image: ${IMAGE}
ctaLabel: 'Find out more'
ctaUrl: '${ORGANISER}'
`;

  // ── Write body ─────────────────────────────────────────────────────────────
  const body = `Fitness on the Field is a weekly outdoor fitness session for women, held on the playing field at **Meadowbrook**.

All ages and all abilities are welcome. It's about getting stronger and fitter and feeling good in your body, in a friendly and supportive community of women.

Little ones are welcome too - the sessions are suitable from five months postpartum.

---

Fitness on the Field runs **every Thursday from 9.15am to 10am** on the [playing field](/facilities/playing-fields) at Meadowbrook. It is run by [Tiny Feet Yoga](${ORGANISER}) rather than by the DRA, so head to their website for details and to get in touch.
`;

  mkdirSync(bodyDir, { recursive: true });
  writeFileSync(yamlPath, yaml);
  writeFileSync(bodyPath, body);

  console.log(`Created: ${slug} - ${dateStr}`);
  created++;
}

console.log(`Done. Created ${created} new Fitness on the Field event(s).`);
