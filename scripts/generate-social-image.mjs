#!/usr/bin/env node
/**
 * generate-social-image.mjs
 *
 * Renders a 1200 × 630 Open Graph PNG for a DRA Social (or any event).
 * Design: full-bleed mood photo → dark scrim → sun-yellow corner pill → big
 * Lobster headline + eyebrow + meta strip anchored bottom-left.
 *
 * Usage (direct):
 *   node scripts/generate-social-image.mjs \
 *     --slug dra-social-june-2026 \
 *     --title "DRA social" \
 *     --date "2026-06-24" \
 *     --time "7pm"
 *
 * Usage (imported by create-social.mjs):
 *   const { generateSocialImage } = await import('./generate-social-image.mjs');
 *   const filename = await generateSocialImage({ slug, title, date, time });
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot   = join(__dirname, '..');

// ── Paths ──────────────────────────────────────────────────────────────────

// Plus Jakarta Sans comes from the @fontsource/plus-jakarta-sans npm package.
// Using the Latin subset keeps the base64 payload small.
const FONTSOURCE_DIR = join(repoRoot, 'node_modules', '@fontsource', 'plus-jakarta-sans', 'files');
const MOOD_DIR      = join(repoRoot, 'mood-photos');
const LOBSTER_PATH  = join(repoRoot, 'public', 'fonts', 'Lobster_1.3.otf');
const OUT_DIR       = join(repoRoot, 'public', 'images', 'events');

// ── Design tokens (mirrors global.css) ─────────────────────────────────────

const SUN   = '#F9D21E';
const INK   = '#28201A';
const EMBER = '#A73916';
const WHITE = '#FFFFFF';

// ── Font loading ───────────────────────────────────────────────────────────

function loadFonts() {
  return [
    {
      name: 'Lobster',
      data: readFileSync(LOBSTER_PATH),
      weight: 400,
      style: 'normal',
    },
    {
      name: 'Plus Jakarta Sans',
      data: readFileSync(join(FONTSOURCE_DIR, 'plus-jakarta-sans-latin-600-normal.woff')),
      weight: 600,
      style: 'normal',
    },
    {
      name: 'Plus Jakarta Sans',
      data: readFileSync(join(FONTSOURCE_DIR, 'plus-jakarta-sans-latin-700-normal.woff')),
      weight: 700,
      style: 'normal',
    },
    {
      name: 'Plus Jakarta Sans',
      data: readFileSync(join(FONTSOURCE_DIR, 'plus-jakarta-sans-latin-800-normal.woff')),
      weight: 800,
      style: 'normal',
    },
  ];
}

// ── Mood photo selection ───────────────────────────────────────────────────

const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function pickPhoto(slug) {
  if (!existsSync(MOOD_DIR)) return null;
  const photos = readdirSync(MOOD_DIR).filter(f => PHOTO_EXTS.has(extname(f).toLowerCase()));
  if (!photos.length) return null;

  // Deterministic: same slug → same photo every run
  const hash  = createHash('sha1').update(slug).digest();
  const index = hash.readUInt32BE(0) % photos.length;
  return join(MOOD_DIR, photos[index]);
}

async function photoToDataUri(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  // Resize to canvas size and compress as JPEG before base64-encoding.
  // Satori fails to render large data URIs; a ~100KB JPEG is reliable.
  const buf = await sharp(filePath)
    .resize(1200, 630, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

// ── Date formatting ────────────────────────────────────────────────────────

function formatDate(dateStr) {
  // dateStr: 'YYYY-MM-DD'
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.toLocaleDateString('en-GB', { weekday: 'short' }); // Thu
  const day = d.toLocaleDateString('en-GB', { day: 'numeric' });   // 26
  const mon = d.toLocaleDateString('en-GB', { month: 'short' });   // Feb
  return `${dow} ${day} ${mon}`;
}

// ── Element helpers ────────────────────────────────────────────────────────
// Satori uses React-like element objects - no JSX needed.

const el = (type, style, children, extra = {}) => ({
  type,
  props: { style, children, ...extra },
});

const div  = (style, children, extra) => el('div',  style, children, extra);
const span = (style, children)        => el('span', style, children);

// ── Card layout ───────────────────────────────────────────────────────────

function buildCard({ title, date, time, photoDataUri }) {
  const titleFontSize = title.length > 18 ? 108 : 132;

  // Fallback when no photo - solid dark background
  const bgLayer = photoDataUri
    ? div({
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        backgroundImage: `url(${photoDataUri})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'flex',
      })
    : div({
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
        backgroundColor: INK,
        display: 'flex',
      });

  const scrimLayer = div({
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    background: [
      'linear-gradient(to top,',
      '  rgba(20,15,10,0.78)  0%,',
      '  rgba(20,15,10,0.55) 35%,',
      '  rgba(20,15,10,0.18) 70%,',
      '  transparent         100%)',
    ].join(' '),
    display: 'flex',
  });

  // Corner pill - top-left
  const cornerPill = div(
    {
      position: 'absolute', top: 28, left: 28,
      display: 'flex', alignItems: 'center', gap: 8,
      backgroundColor: SUN, color: INK,
      paddingTop: 10, paddingBottom: 11, paddingLeft: 16, paddingRight: 16,
      borderRadius: 999,
      fontFamily: '"Plus Jakarta Sans"', fontWeight: 800,
      fontSize: 14, letterSpacing: '0.18em',
    },
    [
      div({ width: 8, height: 8, borderRadius: 999, backgroundColor: EMBER, display: 'flex' }),
      span({ fontFamily: '"Plus Jakarta Sans"', fontWeight: 800, fontSize: 14 }, 'OPEN DOOR · MONTHLY'),
    ]
  );

  // Eyebrow
  const eyebrow = span(
    {
      fontFamily: '"Plus Jakarta Sans"', fontWeight: 600,
      fontSize: 15, letterSpacing: '0.22em', color: SUN,
      textTransform: 'uppercase',
    },
    'COMMUNITY · DARTINGTON · MEADOWBROOK',
  );

  // Headline
  const headline = span(
    {
      fontFamily: 'Lobster', fontWeight: 400,
      fontSize: titleFontSize, lineHeight: 1,
      letterSpacing: '-0.01em', color: WHITE,
    },
    title,
  );

  // Meta items: WHEN / FROM / WHERE
  const whenValue = date ? formatDate(date) : 'Last Thursday\nevery month';
  const metaItems = [
    { k: 'WHEN',  v: whenValue },
    { k: 'FROM',  v: time ?? '7pm' },
    { k: 'WHERE', v: 'Meadowbrook\nDartington' },
  ];

  const metaDivider = div({
    width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.25)',
    display: 'flex',
  });

  const metaBlock = ({ k, v }) => div(
    { display: 'flex', flexDirection: 'column', gap: 2 },
    [
      span(
        { fontFamily: '"Plus Jakarta Sans"', fontWeight: 600, fontSize: 11,
          letterSpacing: '0.22em', textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.7)' },
        k,
      ),
      ...v.split('\n').map(line =>
        span(
          { fontFamily: '"Plus Jakarta Sans"', fontWeight: 700, fontSize: 18,
            lineHeight: 1.1, color: WHITE },
          line,
        )
      ),
    ]
  );

  const metaRow = div(
    { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
    metaItems.flatMap((item, i) => i === 0 ? [metaBlock(item)] : [metaDivider, metaBlock(item)]),
  );

  // Content stack - anchored bottom-left
  const contentStack = div(
    {
      position: 'absolute', bottom: 48, left: 48, right: 48,
      display: 'flex', flexDirection: 'column', gap: 12,
    },
    [eyebrow, headline, metaRow],
  );

  // Root element - must be display:flex for Satori
  return div(
    {
      width: 1200, height: 630,
      position: 'relative',
      display: 'flex',
      backgroundColor: INK,
    },
    [bgLayer, scrimLayer, cornerPill, contentStack],
  );
}

// ── Main export ─────────────────────────────────────────────────────────────

export async function generateSocialImage({ slug, title, date, time }) {
  const photoPath    = pickPhoto(slug);
  const photoDataUri = await photoToDataUri(photoPath);
  const card        = buildCard({ title, date, time, photoDataUri });

  const svg = await satori(card, {
    width: 1200,
    height: 630,
    fonts: loadFonts(),
  });

  // SVG → PNG (via resvg) → compress to JPEG for a ~150KB result
  const resvg     = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const rawPng    = resvg.render().asPng();
  const compressed = await sharp(rawPng)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  mkdirSync(OUT_DIR, { recursive: true });
  const filename = `${slug}-og.jpg`;
  writeFileSync(join(OUT_DIR, filename), compressed);

  console.log(`Image generated: public/images/events/${filename}  (${Math.round(compressed.length / 1024)}KB)`);
  return filename;
}

// ── CLI entry point ────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args   = process.argv.slice(2);
  const flag   = name => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
  const slug   = flag('--slug')  ?? 'dra-social-preview';
  const title  = flag('--title') ?? 'DRA social';
  const date   = flag('--date');
  const time   = flag('--time')  ?? '7pm';

  generateSocialImage({ slug, title, date, time })
    .then(f => console.log('Done:', f))
    .catch(err => { console.error(err); process.exit(1); });
}
