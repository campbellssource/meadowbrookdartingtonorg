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
const POPPINS_DIR   = join(repoRoot, 'node_modules', '@fontsource', 'poppins', 'files');
const MOOD_DIR      = join(repoRoot, 'mood-photos');
const LOBSTER_PATH  = join(repoRoot, 'public', 'fonts', 'Lobster_1.3.otf');
const SCENE_PATH    = join(repoRoot, 'public', 'assets', 'illustrations', 'extravaganza-scene.png');
const OUT_DIR       = join(repoRoot, 'public', 'images', 'events');

// ── Design tokens (mirrors global.css) ─────────────────────────────────────

const SUN   = '#F9D21E';
const INK   = '#28201A';
const EMBER = '#A73916';
const WHITE = '#FFFFFF';

// Extravaganza sub-brand (design-system/Extravaganza Brand.html)
const FESTIVAL = '#F47B1F';   // festival orange — the field
const FEST_INK = '#221C17';   // the "black in the mix"
// Bunting / keyword brights (sun excluded as a text colour — accent only)
const BUNT = ['#1DB5EF', '#E84C7A', '#F9D21E', '#1E9E8E', '#74A953', '#F47B1F'];

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
    {
      name: 'Poppins',
      data: readFileSync(join(POPPINS_DIR, 'poppins-latin-700-normal.woff')),
      weight: 700,
      style: 'normal',
    },
    {
      name: 'Poppins',
      data: readFileSync(join(POPPINS_DIR, 'poppins-latin-800-normal.woff')),
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

// Long, festival-style date: "SATURDAY 11 JULY"
function formatDateLong(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
}

// ── Bunting (Satori can't do clip-path — render as an inline SVG image) ──────

function buntingDataUri({ width = 1200, height = 46, dir = 'down', count = 26 } = {}) {
  const w = width / count;
  let tris = '';
  for (let i = 0; i < count; i++) {
    const x = i * w;
    const c = BUNT[i % BUNT.length];
    const pts = dir === 'down'
      ? `${x},0 ${x + w},0 ${x + w / 2},${height}`
      : `${x},${height} ${x + w},${height} ${x + w / 2},0`;
    tris += `<polygon points="${pts}" fill="${c}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${tris}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// The illustrated scene, cropped near-square for the polaroid. The source asset
// is already a margin-free square framing of the building + bunting + pool, so a
// centred cover keeps the whole composition (an old 'top' crop showed only sky
// and roof).
async function sceneToDataUri() {
  if (!existsSync(SCENE_PATH)) return null;
  const buf = await sharp(SCENE_PATH)
    .resize(720, 640, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 86 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
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

function buildCard({
  title, date, time, photoDataUri,
  pillText = 'OPEN DOOR · MONTHLY',
  eyebrowText = 'COMMUNITY · DARTINGTON · MEADOWBROOK',
  whereText = 'Meadowbrook\nDartington',
  whenFallback = 'Last Thursday\nevery month',
}) {
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
      span({ fontFamily: '"Plus Jakarta Sans"', fontWeight: 800, fontSize: 14 }, pillText),
    ]
  );

  // Eyebrow
  const eyebrow = span(
    {
      fontFamily: '"Plus Jakarta Sans"', fontWeight: 600,
      fontSize: 15, letterSpacing: '0.22em', color: SUN,
      textTransform: 'uppercase',
    },
    eyebrowText,
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
  const whenValue = date ? formatDate(date) : whenFallback;
  const metaItems = [
    { k: 'WHEN',  v: whenValue },
    { k: 'FROM',  v: time ?? '7pm' },
    { k: 'WHERE', v: whereText },
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

// ── Extravaganza card — the festival sub-brand ──────────────────────────────

function buildExtravaganzaCard({ date, time, sceneDataUri }) {
  const PAD = 56;
  const poppins = '"Poppins"';

  // Bunting bands, full bleed top + bottom
  const buntTop = el('img', {
    position: 'absolute', top: 0, left: 0, width: 1200, height: 46, display: 'flex',
  }, undefined, { src: buntingDataUri({ dir: 'down' }) });
  const buntBottom = el('img', {
    position: 'absolute', bottom: 0, left: 0, width: 1200, height: 46, display: 'flex',
  }, undefined, { src: buntingDataUri({ dir: 'up' }) });

  // Polaroid — white border around the scene
  const polaroid = div(
    {
      display: 'flex', flexDirection: 'column',
      backgroundColor: WHITE, padding: 16, borderRadius: 6,
      transform: 'rotate(-2.5deg)',
      boxShadow: '0 18px 40px rgba(40,35,32,0.28)',
    },
    [
      // Render as an <img> rather than a CSS backgroundImage — satori tiles
      // background images (cover is unreliable), which left a visible seam
      // through the scene.
      sceneDataUri
        ? el('img',
            { width: 360, height: 320, objectFit: 'cover', display: 'flex' },
            undefined,
            { src: sceneDataUri })
        : div({ width: 360, height: 320, backgroundColor: '#1DB5EF', display: 'flex' }),
    ],
  );

  // Stamp: hand mark name (text only — keep it light)
  const stamp = span(
    { fontFamily: poppins, fontWeight: 700, fontSize: 22, letterSpacing: '0.04em',
      textTransform: 'uppercase', color: WHITE },
    'MEADOWBROOK',
  );

  const wordmark = span(
    { fontFamily: poppins, fontWeight: 800, fontSize: 82, lineHeight: 0.92,
      letterSpacing: '-0.02em', textTransform: 'uppercase', color: WHITE },
    'EXTRAVAGANZA',
  );

  const sub = span(
    { fontFamily: poppins, fontWeight: 700, fontSize: 27, color: WHITE, marginTop: 6 },
    'Our annual fête and fundraiser',
  );

  // Keyword line — white / black / sky (brand "playful" option)
  const keys = div(
    { display: 'flex', flexDirection: 'row', gap: 12, marginTop: 12 },
    [
      span({ fontFamily: poppins, fontWeight: 800, fontSize: 32, textTransform: 'uppercase', color: WHITE }, 'Music.'),
      span({ fontFamily: poppins, fontWeight: 800, fontSize: 32, textTransform: 'uppercase', color: FEST_INK }, 'Food.'),
      span({ fontFamily: poppins, fontWeight: 800, fontSize: 32, textTransform: 'uppercase', color: '#1DB5EF' }, 'Family fun.'),
    ],
  );

  // Date + time
  const when = div(
    { display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 16, marginTop: 22 },
    [
      span({ fontFamily: poppins, fontWeight: 800, fontSize: 40, letterSpacing: '-0.01em', color: WHITE },
        date ? formatDateLong(date) : 'SATURDAY 11 JULY'),
      span({ fontFamily: poppins, fontWeight: 800, fontSize: 30, textTransform: 'uppercase', color: SUN },
        (time ?? 'Noon–6pm').toUpperCase()),
    ],
  );

  // Activities — words in the brights (sun excluded as a text colour)
  const ACTS = [
    ['Music', WHITE], ['BBQ', '#1DB5EF'], ['Games', '#E84C7A'], ['Stalls', FEST_INK],
    ['Football tournament', '#1E9E8E'], ['Dog show', '#74A953'], ['Bouncy castles', WHITE],
  ];
  const acts = div(
    { display: 'flex', flexWrap: 'wrap', gap: '8px 22px', marginTop: 18, width: 640 },
    ACTS.map(([w, c]) =>
      span({ fontFamily: poppins, fontWeight: 800, fontSize: 24, textTransform: 'uppercase', color: c }, w),
    ),
  );

  const url = span(
    { fontFamily: poppins, fontWeight: 700, fontSize: 22, color: WHITE, marginTop: 26 },
    'meadowbrookdartington.org',
  );

  const textCol = div(
    { display: 'flex', flexDirection: 'column', flex: 1 },
    [stamp, wordmark, sub, keys, when, acts, url],
  );

  const content = div(
    { position: 'absolute', top: 46, bottom: 46, left: PAD, right: PAD,
      display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 44 },
    [polaroid, textCol],
  );

  return div(
    { width: 1200, height: 630, position: 'relative', display: 'flex', backgroundColor: FESTIVAL },
    [buntTop, buntBottom, content],
  );
}

// ── Main export ─────────────────────────────────────────────────────────────

export async function generateSocialImage({ slug, title, date, time, cardOpts = {} }) {
  let card;
  if (slug === 'extravaganza') {
    const sceneDataUri = await sceneToDataUri();
    card = buildExtravaganzaCard({ date, time, sceneDataUri });
  } else {
    const photoPath    = pickPhoto(slug);
    const photoDataUri = await photoToDataUri(photoPath);
    card               = buildCard({
      title, date, time, photoDataUri,
      pillText:     cardOpts.pill,
      eyebrowText:  cardOpts.eyebrow,
      whereText:    cardOpts.where,
      whenFallback: cardOpts.whenFallback,
    });
  }

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
