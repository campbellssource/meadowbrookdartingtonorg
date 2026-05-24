# Handoff: Brand brief page

A new page for **meadowbrookdartington.org**, intended to live at something like `/brand` or `/brand-brief`. Tells the Meadowbrook + DRA brand story, shows colours and type, and gives anyone making assets (volunteers, partners, designers) the rules and files they need.

---

## About these files

The files in this bundle are a **design reference created in HTML** — a single-page prototype showing intended look, layout and content. They are **not production code to copy directly**.

Your task is to **recreate this page inside the existing meadowbrookdartington.org codebase**, using whatever framework, component library, image pipeline and CMS patterns the rest of the site uses. The HTML/CSS in this bundle is the source of truth for layout, colour, type and copy — not for component structure or markup conventions.

If the codebase already has a design-tokens file, a typography scale or a section/heading component, use those rather than inlining values from this prototype.

---

## Fidelity

**High-fidelity.** Final colours, type, spacing, content and section order. Recreate it pixel-close, but adapt:

- Markup → existing template/component conventions in the codebase.
- Class names → existing naming scheme (BEM, utility, CSS modules, Tailwind — whatever's in use).
- Inline styles in the prototype → consolidate into design tokens / component CSS.
- Hardcoded asset paths → the site's existing asset pipeline.

The prototype uses `colors_and_type.css` as a tokens file — these tokens already exist (in some form) in the live codebase. **Don't add a second copy of them**; map the prototype to whatever's already there. If something is missing on the live site (e.g. a `--paper-deep` doesn't exist yet), add it to the existing tokens file.

---

## Page sections (in order)

1. **Hero** — hand logo + version stamp, h1 ("Make things that feel like Meadowbrook."), lede paragraph, four-column meta row (For / Owner / Questions / blank).
2. **The story** — long-form narrative, max width 720px, single column. Includes a green pull-quote band.
3. **Voice** — sits on `--paper-deep`. Two-column "Sounds right / Doesn't sound like us" tiles on `--bone`, with a short note below.
4. **Marks (logo)** — 1.3/1 grid. Cream card with hand logo on the left, paper-deep notes card on the right (Hand / Lockup / Don't).
5. **Colours — core** — `--paper-deep` background. Three sub-sections: canvas / brights / ink. Swatch grid `1.4fr 1fr 1fr 1fr`. The base paper swatch is `grid-row: span 2`.
6. **Colours — zone palettes** — Nine zone cards in a 3-col grid. Each card uses its own zone background + display font for the name, then four colour stripes with hex codes overlaid.
7. **Type** — `--paper-deep` background. A big body/UI card (Plus Jakarta Sans specimen), then a 2-col grid of nine zone-font cards (each in its own zone colour, with its display font rendering a short specimen).
8. **Photography** — 3-col 4:5 photo grid (uses real `assets/photos/*` from the site), one empty placeholder tile, prose note about colour grading.
9. **House rules** — `--paper-deep` background. 2-col Do / Don't tiles, alternating colours: Do = `--bone`, Don't = `#EFE3D2`.
10. **Assets** — 2-col list of pickable assets, each row `64px thumb · name + path · tag`.
11. **Contact** — Ink-coloured card with sun-yellow eyebrow and two CTAs (Email us, Back to site).
12. **Colophon** — small caption row: charity number left, version + date right.

`Brand Brief.html` shows all of the above end-to-end. Open it locally as the visual reference.

---

## Layout system

Same one used elsewhere on the site:

| Token | Value | Notes |
|---|---|---|
| `--content-max` | 1200px | Outer container max width |
| `--content-narrow` | 720px | Used for the story section only |
| `--gutter` | `clamp(1rem, 4vw, 2.5rem)` | Horizontal page padding |
| Vertical section padding | `var(--space-8)` (64px) | Default `<section>` rhythm |
| Tall section padding | `var(--space-9)` (96px) | Story section uses this |
| Section background shifts | `--paper` ↔ `--paper-deep` | **The only divider between sections.** Never a 1px border. |

Responsive breakpoint at `max-width: 880px`:
- All 2-, 3- and 4-col grids → single column.
- Logo grid → single column.
- Core swatch grid → 2 columns; the `.lg` swatch loses `grid-row: span 2`.
- Type card → stacks vertically.
- Contact card → stacks; actions left-align.

---

## Design tokens

These already exist in `colors_and_type.css`. Map them to whatever the codebase calls them.

### Colour — core canvas

| Name | Hex | Role |
|---|---|---|
| Paper cream | `#FBF0DF` | Base background |
| Paper deep | `#F4E4CB` | Tonal step / alt section bg |
| Sandy stone | `#D1B08B` | Block colour |
| Bone | `#FFFFFF` | Card / surface |
| Cream lift | `#FFFBF2` | Elevated surface |
| Meadow green | `#74A953` | Primary accent (logo green) |
| Green light | `#A7C756` | Fresh upper green |
| Green dark | `#4D7A33` | AA contrast accent |

### Colour — brights

| Name | Hex | Role |
|---|---|---|
| Sun yellow | `#F9D21E` | Punch |
| Sky blue | `#1DB5EF` | Punch |
| Wood red | `#A73916` | Warn / festive |
| Building grey | `#3C3C3A` | Night |

### Colour — ink

| Name | Hex | Role |
|---|---|---|
| Ink | `#28201A` | Body text (never pure black) |
| Ink soft | `#5B4E42` | Secondary text |
| Ink mute | `#8B7C6E` | Metadata, eyebrows |

### Colour — zones (each zone is a self-contained palette)

| Zone | Bg | Bg deep | Accent | Display font |
|---|---|---|---|---|
| Extravaganza | `#F9D21E` | `#E8BE0A` | `#A73916` (also green `#74A953`) | Abril Fatface |
| Dartington Pool | `#20B9DB` | `#1098B7` | `#000` (also `#A0D8EA`) | Rexton (300, +0.18em, uppercase) |
| Snooker | `#004D26` | `#181C1B` | `#F9D21E` | Billiard |
| Bike Track | `#F04E23` | `#C53A14` | `#000` (also `#FFF`) | Bebas Neue |
| Playing Fields | `#228B22` | `#166916` | `#FFF` | Oswald 700, uppercase |
| Playground | `#FFA500` | `#E68A00` | `#FF4500` (also sky `#1DB5EF`) | Nunito 900 |
| Studio | `#F5DEB3` | `#E8C98A` | `#D2691E` (text `#4A2A0A`) | Josefin Sans 300 |
| Lounge | `#401D00` | `#2A1200` | `#EEC776` | Righteous |
| the DRA | `#FBF0DF` | `#F4E4CB` | `#74A953` | Lobster |

### Type

- **Body + UI: Plus Jakarta Sans.** Google Fonts. Weights 400, 500, 600, 700. Body 16px / line-height 1.6. Display sizes use `letter-spacing: -0.02em`.
- **Display fonts per zone:** see the table above. Six are Google Fonts (Abril Fatface, Bebas Neue, Oswald, Nunito, Josefin Sans, Righteous). Three are **brand files** that must be self-hosted: Rexton (full weight family — six OTFs), Billiard, Lobster. The OTFs are included in this bundle under `fonts/`.
- Eyebrows / labels: 12px, `letter-spacing: 0.08em`, `text-transform: uppercase`, `font-weight: 600`.
- All copy is **sentence case** except proper nouns.

### Spacing scale — 4px base

`--space-1` 4px · `--space-2` 8px · `--space-3` 12px · `--space-4` 16px · `--space-5` 24px · `--space-6` 32px · `--space-7` 48px · `--space-8` 64px · `--space-9` 96px · `--space-10` 128px

### Radii

`--r-xs` 2 · `--r-sm` 4 · `--r-md` 8 · `--r-lg` 14 · `--r-xl` 22 · `--r-pill` 999

### Shadows

Used sparingly — prefer tonal layering.
- `--shadow-float: 0 20px 40px rgba(40, 35, 32, 0.06)`
- `--shadow-press: 0 2px 6px rgba(40, 35, 32, 0.08)`
- `--shadow-pop: 0 30px 80px -20px rgba(40, 35, 32, 0.18)`

### Motion

- `--ease-natural: cubic-bezier(0.22, 0.61, 0.36, 1)`
- Durations: 140ms / 220ms / 420ms
- No bouncy springs except inside the Playground zone.

---

## Interactions & behaviour

The page is mostly static content. The only interactive elements:

- **Email us** anchor → `mailto:contact@meadowbrookdartington.org`
- **Back to site** anchor → `/` (use site router, not a hard reload)
- Hover state on the two contact CTAs: standard site button hover (background shifts one tonal step deeper, no hue rotation).
- All links: thicker underline on hover (1px → 2px, `text-underline-offset: 0.18em`).

No JS state, no fetches, no animation beyond the hover transitions. The page is essentially a long-form article with structured colour/type panels.

---

## Content / copy

All copy in the prototype is final and should be lifted verbatim. Pay attention to:

- Sentence case throughout (`Make things that feel like Meadowbrook.` — not Title Case).
- "we"/"us" = the whole community, not just the DRA.
- Italic emphasis on the proper nouns *Meadowbrook* and *the DRA* in the story section.
- The two house-rule examples that should render with `<code>`: `#FBF0DF` and the file paths.

---

## Assets

All assets used by the prototype are included under `assets/`. They're already on the live site at the same paths — **do not re-upload**, just reference them.

| Asset | Path |
|---|---|
| Hand logo | `assets/logos/hand.png` |
| Bike track badge | `assets/logos/bike-track-badge.png` |
| Site map | `assets/illustrations/map.png` |
| Pool ring icon | `assets/illustrations/pool-icon.png` |
| Playing fields motif | `assets/illustrations/playing-fields-motif.png` |
| Pool tile texture | `assets/textures/pool-tile.png` |
| Hero photo | `assets/photos/hero.webp` |
| Brook · bluebells | `assets/photos/brook.png` |
| Bike track action | `assets/photos/bike-track.webp` |
| Extravaganza parachute | `assets/photos/extravaganza-parachute.webp` |

### Fonts to self-host

Drop these OTFs into the site's fonts directory (matching whatever convention the site already uses) and add `@font-face` rules. See `colors_and_type.css` for ready-made declarations.

- `fonts/Rexton-Light.otf` (300)
- `fonts/Rexton-Regular.otf` (400)
- `fonts/Rexton-Medium.otf` (500)
- `fonts/Rexton-Bold.otf` (700)
- `fonts/Rexton-ExtraBold.otf` (800)
- `fonts/Rexton-Black.otf` (900)
- `fonts/Billiard.otf`
- `fonts/Lobster_1.3.otf`

---

## SEO / meta

- `<title>`: **Brand brief | Meadowbrook Dartington**
- Meta description: "How to make things that feel like Meadowbrook — voice, colour, type and assets for anyone making materials with our name on it."
- OG image: `assets/photos/hero.webp` (existing site default is fine)
- Add the page to the sitemap. Probably **not** in the main nav — link to it from the footer under "Explore" or "About", and from the volunteer / partner email signature.

---

## Accessibility checklist

- All colour text combinations in the prototype meet AA. The Pool zone uses `#000` on `#20B9DB` deliberately; keep it.
- Hand logo `<img>` needs `alt="Meadowbrook + DRA logo"`.
- The 4:5 photos in the photography grid: provide real, descriptive alt text in the implementation (the prototype uses captions as a visual element, not as alt).
- The placeholder photo tile (`Drop a new zone photo here`) is decorative; mark `aria-hidden="true"` or remove if no asset is supplied.
- Section headings: every section starts with an `<h2>`. Don't skip levels.

---

## Files in this bundle

| File | What it is |
|---|---|
| `Brand Brief.html` | The design reference — open this locally to see the page. |
| `colors_and_type.css` | The design tokens used by the prototype. Reference, not for copy-paste. |
| `design_system_README.md` | The full Meadowbrook + DRA design system README — voice, visual foundations, motion, iconography. **Read this first if you haven't worked on the site before.** |
| `assets/` | Logos, illustrations, textures, photos used on the page. |
| `fonts/` | The three brand fonts (Rexton, Billiard, Lobster) that must be self-hosted. |

---

## A note on tone

This page is unusual for the site in that it's a meta-document — it's *about* the brand rather than *being* a piece of communication. Resist any temptation to make it look more "design-systemy" than the rest of meadowbrookdartington.org. Same layout, same voice, same papery cream. The brand brief should feel like a long article in the magazine, not a Figma component library.
