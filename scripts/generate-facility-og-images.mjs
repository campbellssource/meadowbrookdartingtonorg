#!/usr/bin/env node
/**
 * generate-facility-og-images.mjs
 *
 * Generates 1200×630 Open Graph JPEG images for every facility page.
 * Each image uses the facility photo as a full-bleed background with a
 * zone-coloured gradient scrim, mirroring the branding in global.css.
 *
 * Usage:
 *   node scripts/generate-facility-og-images.mjs            # all facilities
 *   node scripts/generate-facility-og-images.mjs --slug pool # one facility
 *
 * Output: public/images/facilities/{slug}-og.jpg
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot   = join(__dirname, '..');

// ── Paths ──────────────────────────────────────────────────────────────────

const FONTS_DIR     = join(repoRoot, 'public', 'fonts');
const FONTSOURCE_DIR = join(repoRoot, 'node_modules', '@fontsource', 'plus-jakarta-sans', 'files');
const CONTENT_DIR   = join(repoRoot, 'src', 'content', 'facilities');
const PUBLIC_DIR    = join(repoRoot, 'public');
const OUT_DIR       = join(repoRoot, 'public', 'images', 'facilities');

// ── Zone colours (mirrors global.css) ─────────────────────────────────────
// bgDeep: used for the gradient scrim colour
// pillBg / pillFg: corner pill colours
// font: display font for the headline

const ZONES = {
  pool:       { bgDeep: '#0B6A82', fg: '#FFFFFF', pillBg: '#20B9DB', pillFg: '#000000', font: 'Rexton' },
  snooker:    { bgDeep: '#001E0C', fg: '#FFFFFF', pillBg: '#004D26', pillFg: '#F9D21E', font: 'Billiard' },
  scuba:      { bgDeep: '#025E6B', fg: '#FFFFFF', pillBg: '#0490A4', pillFg: '#FFFFFF', font: 'Plus Jakarta Sans' },
  muga:       { bgDeep: '#111214', fg: '#FFFFFF', pillBg: '#2C2E30', pillFg: '#F9D21E', font: 'Plus Jakarta Sans' },
  fields:     { bgDeep: '#0D3D0D', fg: '#FFFFFF', pillBg: '#228B22', pillFg: '#FFFFFF', font: 'Plus Jakarta Sans' },
  playground: { bgDeep: '#7A4000', fg: '#FFFFFF', pillBg: '#FFA500', pillFg: '#28201A', font: 'Plus Jakarta Sans' },
  bike:       { bgDeep: '#6A1A05', fg: '#FFFFFF', pillBg: '#F04E23', pillFg: '#000000', font: 'Plus Jakarta Sans' },
  studio:     { bgDeep: '#3A1A00', fg: '#FFFFFF', pillBg: '#4A2A0A', pillFg: '#F5DEB3', font: 'Plus Jakarta Sans' },
  lounge:     { bgDeep: '#1A0A00', fg: '#EEC776', pillBg: '#401D00', pillFg: '#EEC776', font: 'Plus Jakarta Sans' },
  sauna:      { bgDeep: '#4A1E0E', fg: '#FFFFFF', pillBg: '#A0522D', pillFg: '#FFFFFF', font: 'Plus Jakarta Sans' },
  bar:        { bgDeep: '#080808', fg: '#FFFFFF', pillBg: '#1A1A1A', pillFg: '#F9D21E', font: 'Plus Jakarta Sans' },
  core:       { bgDeep: '#28201A', fg: '#FFFFFF', pillBg: '#28201A', pillFg: '#FBF0DF', font: 'Plus Jakarta Sans' },
};

const SLUG_TO_ZONE = {
  'pool':               'pool',
  'bike-track':         'bike',
  'snooker-room':       'snooker',
  'playground':         'playground',
  'playing-fields':     'fields',
  'large-room':         'studio',
  'small-room':         'lounge',
  'pizzalogica':        'bar',
  'somewhere-sauna':    'sauna',
  'woodland-and-brook': 'core',
  'things-happen-here': 'bar',
  'muga':               'muga',
  'totnes-sub-aqua-club': 'scuba',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function resolveImagePath(imageField) {
  if (!imageField) return null;
  const abs = imageField.startsWith('/')
    ? join(PUBLIC_DIR, imageField)
    : join(PUBLIC_DIR, 'images', 'facilities', imageField);
  return existsSync(abs) ? abs : null;
}

async function photoToDataUri(filePath) {
  if (!filePath) return null;
  const buf = await sharp(filePath)
    .resize(1200, 630, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

// ── Font loading ───────────────────────────────────────────────────────────

function loadFonts() {
  const fonts = [
    {
      name: 'Plus Jakarta Sans',
      data: readFileSync(join(FONTSOURCE_DIR, 'plus-jakarta-sans-latin-600-normal.woff')),
      weight: 600, style: 'normal',
    },
    {
      name: 'Plus Jakarta Sans',
      data: readFileSync(join(FONTSOURCE_DIR, 'plus-jakarta-sans-latin-700-normal.woff')),
      weight: 700, style: 'normal',
    },
    {
      name: 'Plus Jakarta Sans',
      data: readFileSync(join(FONTSOURCE_DIR, 'plus-jakarta-sans-latin-800-normal.woff')),
      weight: 800, style: 'normal',
    },
  ];

  const rextonPath = join(FONTS_DIR, 'Rexton-ExtraBold.otf');
  if (existsSync(rextonPath)) {
    fonts.push({ name: 'Rexton', data: readFileSync(rextonPath), weight: 800, style: 'normal' });
  }

  const billiardPath = join(FONTS_DIR, 'Billiard.otf');
  if (existsSync(billiardPath)) {
    fonts.push({ name: 'Billiard', data: readFileSync(billiardPath), weight: 400, style: 'normal' });
  }

  return fonts;
}

// ── Element helpers ────────────────────────────────────────────────────────

const el   = (type, style, children, extra = {}) => ({ type, props: { style, children, ...extra } });
const div  = (style, children, extra) => el('div',  style, children, extra);
const span = (style, children)        => el('span', style, children);

// ── Card layout ────────────────────────────────────────────────────────────

function buildCard({ name, pillLabel, description, zone, photoDataUri }) {
  const colors = ZONES[zone] ?? ZONES.core;
  const { bgDeep, pillBg, pillFg, font } = colors;

  const fontSize = name.length <= 7 ? 96 : name.length <= 12 ? 80 : name.length <= 18 ? 64 : 52;
  const headlineFontFamily = font === 'Rexton' ? 'Rexton' : font === 'Billiard' ? 'Billiard' : '"Plus Jakarta Sans"';
  const headlineFontWeight = font === 'Billiard' ? 400 : 800;

  // Layer 1: photo background (or solid deep colour as fallback)
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
        backgroundColor: bgDeep,
        display: 'flex',
      });

  // Layer 2: zone-coloured gradient scrim — heaviest at the bottom where text sits
  const scrimLayer = div({
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    background: [
      'linear-gradient(to top,',
      `  ${hexToRgba(bgDeep, 0.94)}  0%,`,
      `  ${hexToRgba(bgDeep, 0.72)} 30%,`,
      `  ${hexToRgba(bgDeep, 0.22)} 62%,`,
      '  transparent           100%)',
    ].join(' '),
    display: 'flex',
  });

  // Corner pill (top-left): facility type label
  const cornerPill = div(
    {
      position: 'absolute', top: 28, left: 28,
      display: 'flex', alignItems: 'center', gap: 8,
      backgroundColor: pillBg, color: pillFg,
      paddingTop: 10, paddingBottom: 11, paddingLeft: 16, paddingRight: 16,
      borderRadius: 999,
      fontFamily: '"Plus Jakarta Sans"', fontWeight: 800,
      fontSize: 13, letterSpacing: '0.18em',
    },
    [
      div({ width: 7, height: 7, borderRadius: 999, backgroundColor: pillFg, display: 'flex' }),
      span({ fontFamily: '"Plus Jakarta Sans"', fontWeight: 800, fontSize: 13 }, pillLabel),
    ]
  );

  // Bottom content: eyebrow → headline → description
  const eyebrowEl = span(
    {
      fontFamily: '"Plus Jakarta Sans"', fontWeight: 600,
      fontSize: 14, letterSpacing: '0.20em',
      color: 'rgba(255,255,255,0.65)',
      textTransform: 'uppercase',
    },
    'MEADOWBROOK · DARTINGTON',
  );

  const headline = span(
    {
      fontFamily: headlineFontFamily,
      fontWeight: headlineFontWeight,
      fontSize,
      lineHeight: 1.05,
      color: '#FFFFFF',
      letterSpacing: font === 'Rexton' ? '0.02em' : '-0.01em',
    },
    name,
  );

  const children = [eyebrowEl, headline];

  if (description) {
    children.push(
      span(
        {
          fontFamily: '"Plus Jakarta Sans"', fontWeight: 600,
          fontSize: 18, color: 'rgba(255,255,255,0.72)',
          lineHeight: 1.3,
        },
        description,
      )
    );
  }

  const contentStack = div(
    {
      position: 'absolute', bottom: 48, left: 48, right: 48,
      display: 'flex', flexDirection: 'column', gap: 10,
    },
    children,
  );

  return div(
    {
      width: 1200, height: 630,
      position: 'relative',
      display: 'flex',
      backgroundColor: bgDeep,
    },
    [bgLayer, scrimLayer, cornerPill, contentStack],
  );
}

// ── Read all facility YAML files ───────────────────────────────────────────

function loadFacilities() {
  return readdirSync(CONTENT_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(filename => {
      const slug = filename.replace('.yaml', '');
      const raw  = readFileSync(join(CONTENT_DIR, filename), 'utf8');
      const data = yaml.load(raw);
      return { slug, ...data };
    });
}

// ── Generate one image ─────────────────────────────────────────────────────

async function generateFacilityImage(facility) {
  const { slug, name, shortDescription, image, facilityType } = facility;
  const zone = SLUG_TO_ZONE[slug] ?? 'core';
  const disc = facilityType?.discriminant ?? 'generic';

  const pillLabel =
    disc === 'bookable' ? 'BOOKABLE SPACE' :
    disc === 'link'     ? 'ON SITE'        :
                          'FACILITY';

  const imagePath    = resolveImagePath(image);
  const photoDataUri = await photoToDataUri(imagePath);

  const card = buildCard({
    name,
    pillLabel,
    description: shortDescription ?? null,
    zone,
    photoDataUri,
  });

  const svg = await satori(card, {
    width: 1200,
    height: 630,
    fonts: loadFonts(),
  });

  const resvg      = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const rawPng     = resvg.render().asPng();
  const compressed = await sharp(rawPng)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  mkdirSync(OUT_DIR, { recursive: true });
  const filename = `${slug}-og.jpg`;
  writeFileSync(join(OUT_DIR, filename), compressed);
  console.log(`  ✓ ${filename}  (${Math.round(compressed.length / 1024)}KB)`);
  return filename;
}

// ── CLI entry point ────────────────────────────────────────────────────────

const filterSlug = (() => {
  const i = process.argv.indexOf('--slug');
  return i !== -1 ? process.argv[i + 1] : null;
})();

const facilities = loadFacilities().filter(f => !filterSlug || f.slug === filterSlug);
console.log(`Generating OG images for ${facilities.length} facilit${facilities.length === 1 ? 'y' : 'ies'}…`);

for (const facility of facilities) {
  await generateFacilityImage(facility);
}
console.log('Done.');
