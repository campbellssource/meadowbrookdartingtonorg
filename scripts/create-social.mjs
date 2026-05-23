#!/usr/bin/env node
/**
 * Creates the next DRA Social event file if it doesn't already exist.
 *
 * The DRA Social is held on the last Thursday of every month.
 * Run this on the 1st of each month (via GitHub Actions) and it will
 * create the event for that month's social.
 *
 * Also accepts --month and --year flags for manual backfill:
 *   node scripts/create-social.mjs --month 8 --year 2026
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ── Parse optional CLI flags ───────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? parseInt(args[i + 1], 10) : null;
};
const cliMonth = flag('--month'); // 1-indexed
const cliYear  = flag('--year');

// ── Date helpers ───────────────────────────────────────────────────────────
function lastThursdayOf(year, month0) {
  // month0 is 0-indexed (0 = Jan)
  const lastDay = new Date(year, month0 + 1, 0); // last day of month
  const dow = lastDay.getDay();                   // 0=Sun … 6=Sat; Thu=4
  const daysBack = dow >= 4 ? dow - 4 : dow + 3;
  return new Date(year, month0, lastDay.getDate() - daysBack);
}

function toDateStr(d) {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

// ── Determine target month ─────────────────────────────────────────────────
let targetYear, targetMonth0;

if (cliMonth !== null && cliYear !== null) {
  targetYear   = cliYear;
  targetMonth0 = cliMonth - 1; // convert to 0-indexed
} else {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  targetYear   = now.getFullYear();
  targetMonth0 = now.getMonth();

  // If this month's social has already passed, move to next month
  const socialThisMonth = lastThursdayOf(targetYear, targetMonth0);
  if (today > socialThisMonth) {
    targetMonth0++;
    if (targetMonth0 > 11) { targetMonth0 = 0; targetYear++; }
  }
}

const socialDate = lastThursdayOf(targetYear, targetMonth0);
const dateStr    = toDateStr(socialDate);
const monthName  = socialDate.toLocaleDateString('en-GB', { month: 'long' }); // e.g. June
const year       = socialDate.getFullYear();

// ── Paths ──────────────────────────────────────────────────────────────────
const slug    = `dra-social-${monthName.toLowerCase()}-${year}`;
const yamlPath = join(repoRoot, 'src/content/events', `${slug}.yaml`);
const bodyDir  = join(repoRoot, 'src/content/events', slug);
const bodyPath = join(bodyDir, 'body.mdoc');

// ── Idempotency check ──────────────────────────────────────────────────────
if (existsSync(yamlPath)) {
  console.log(`Already exists — skipping: ${slug}`);
  process.exit(0);
}

// ── Cap at 2 upcoming socials ──────────────────────────────────────────────
const eventsDir = join(repoRoot, 'src/content/events');
const today2 = new Date(); today2.setHours(0, 0, 0, 0);
const upcomingSocials = readdirSync(eventsDir)
  .filter(f => f.startsWith('dra-social-') && f.endsWith('.yaml'))
  .filter(f => {
    const content = readFileSync(join(eventsDir, f), 'utf8');
    const match = content.match(/^date:\s*'?(\d{4}-\d{2}-\d{2})/m);
    if (!match) return false;
    return new Date(match[1] + 'T12:00:00') >= today2;
  });

if (upcomingSocials.length >= 2) {
  console.log(`Already have ${upcomingSocials.length} upcoming socials — skipping.`);
  process.exit(0);
}

// ── Write YAML ─────────────────────────────────────────────────────────────
const yaml = `title: 'DRA Social – ${monthName} ${year}'
date: '${dateStr}'
startTime: '7pm'
location: "Meadowbrook, can't find us, ask at the bar"
summary: >-
  Come and meet the volunteers and trustees behind Meadowbrook. A relaxed
  monthly get-together — all welcome, whether you're new to the village or
  have been here for years.
`;

// ── Write body ─────────────────────────────────────────────────────────────
const body = `Come and hang out with the team behind Meadowbrook and the Dartington Recreation Association.

The DRA Social is a relaxed, informal gathering — a chance to meet the people who run the site, hear what's going on, and share your ideas for the future of Meadowbrook.

All welcome. No agenda, no formalities, just good company.

---

The DRA Social takes place on the **last Thursday of every month**, from 7pm upstairs at Meadowbrook.
`;

// ── Generate OG image ──────────────────────────────────────────────────────
let imageFilename = null;
try {
  const { generateSocialImage } = await import('./generate-social-image.mjs');
  imageFilename = await generateSocialImage({
    slug,
    title: `DRA Social – ${monthName} ${year}`,
    date: dateStr,
    time: '7pm',
  });
} catch (err) {
  console.warn(`Image generation skipped: ${err.message}`);
}

// ── Write YAML (with image if generated) ──────────────────────────────────
const yamlWithImage = imageFilename
  ? yaml + `image: '${imageFilename}'\n`
  : yaml;

mkdirSync(bodyDir, { recursive: true });
writeFileSync(yamlPath, yamlWithImage);
writeFileSync(bodyPath, body);

console.log(`Created: ${slug} — ${dateStr}`);
