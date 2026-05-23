# Meadowbrook + the DRA - Design System

Meadowbrook is the recreational heart of Dartington - a wooden 1960s community building, grassy mounds, an outdoor pool waiting to be restored, a playground, a bar, playing fields, a bike track and nature trails. The **DRA (Dartington Recreation Association)** is the charity that runs it. Meadowbrook is what people know; the DRA are the people who make it work.

The design system is a **chameleon**: a calm, papery core that steps back to let the facilities and their sub-brand "zones" be the stars. Photography does most of the heavy lifting. Type, colour and motif change per zone; spacing, layout, voice and motion stay the same.

---

## CONTENT FUNDAMENTALS

### Voice
Warm and direct. Write as a neighbour or friend, not a corporation. "We" and "us" mean the whole community, not just DRA staff. Address the reader as "you".

Optimistic but grounded. Meadowbrook has rough edges - a pool that needs restoring, a community building that's seen better days. Copy acknowledges this without apologising.

### Casing
**Sentence case throughout.** Never title case in body or UI. Zone and facility names are proper nouns; everything else is lowercase.

- UI labels: `Book a table`, not `Book A Table`
- Buttons: `Find out more`
- Navigation: `What's on`, `About us`
- Zone names stay proper: `Outdoor Pool`, `The Building`

### Length
Headlines are punchy - often just 2–4 words. Body copy gets to the point fast.

### Emoji
None in formal materials. Informal social posts may use them sparingly.

### Examples
- ✅ "Come as you are."
- ✅ "The pool is closed for now. Help us bring it back."
- ✅ "A place to swim, kick around, eat pizza and stay too late."
- ✅ "Cross the bridge, find the fields."
- ❌ "Experience World-Class Recreation At Dartington!"
- ❌ "🏊 Splash Zone Active 🏊"
- ❌ "Unlock your full potential with our state-of-the-art facilities."

---

## VISUAL FOUNDATIONS

### Backgrounds & palette
The core palette is drawn from the landscape itself. The page rests on **warm papery cream (`#FBF0DF`)** with blocks of **sandy stone (`#D1B08B`)** and clean white. Greens (`#74A953`, `#A7C756`) come from the hand logo and the grassy mounds dug when the community built the pool. Bright primaries - **sun yellow `#F9D21E`** and **sky blue `#1DB5EF`** - are used sparingly for punch. **Building-grey `#3C3C3A`** and **wood-red `#A73916`** are the night/evening palette.

**Background patterns** are real - pool-tile photography, playing-fields white-line motifs, hand-painted maps. We do **not** use synthetic SVG patterns, repeating "geometric" wallpapers, or generated noise textures. When we want texture, we use a photograph.

**No bluish-purple gradients. No emoji cards. No left-border accent rounded rectangles.** If a gradient appears it is a subtle paper-to-deep-paper top→bottom wash, never a multi-stop spectrum.

### Type
Body and UI are always **Plus Jakarta Sans** (regular / medium / semibold / bold). Display headlines change per zone - Abril Fatface for events, Bebas Neue for the bike track, Lobster for the DRA, etc. Pair a Display headline with a Label eyebrow for a magazine-style layout. Letter-spacing is tight on Display (`-0.02em`) and loose on Labels (`+0.05em`). Body text wraps to 60–75 characters.

### No borders, no dividers
Sections are separated by **background shifts and spacing**, never `1px solid` lines. If you reach for a divider, increase the gap or shift the background tone instead.

### Shadows & elevation
Prefer **tonal layering** - light surface vs slightly lighter surface - over drop shadows. When a floating element genuinely needs separation (a modal, a sticky CTA), use a single diffused soft shadow: `0 20px 40px rgba(40, 35, 32, 0.06)`. Never a harsh `0 2px 4px rgba(0,0,0,0.5)`.

### Corner radii
Generous and soft. Cards are `r-md` (14px) or `r-lg` (22px). Buttons are pill-shaped (`r-pill`) or `r-md`. The only hard 90° corners are full-bleed photography blocks.

### Cards
A card is a tonal block - a `--bg-elevated` rectangle with `r-lg` corners, generous padding (32px+), no border, no shadow by default. If a card sits on a coloured zone background it may have a soft `shadow-float` for separation. Photography in cards bleeds to the corners.

### Transparency & blur
Used **rarely**. The nav bar may go transparent → solid on scroll over hero photography. Modal overlays use `rgba(40, 35, 32, 0.4)` - never frosted glass / backdrop-filter as a default styling.

### Hover & press states
- **Hover (links)**: thicker underline (1px → 2px).
- **Hover (buttons)**: background shifts one tonal step deeper (`--bg-elevated` → `--bg-deep`), never a hue rotation.
- **Hover (cards)**: tiny translate `translateY(-2px)` over 220ms, no scale, no shadow bloom.
- **Press**: 96% scale, 140ms.

### Motion
Gentle, natural. `cubic-bezier(0.22, 0.61, 0.36, 1)` for everything. Durations 140 / 220 / 420ms. **No bouncy springs** except inside the Playground zone, where a soft overshoot is welcome. **No parallax scroll** on hero photography - let the photo be still.

### Layout rules
- Max content width 1200px (`--content-max`).
- Narrow prose 720px (`--content-narrow`).
- Gutter: `clamp(1rem, 4vw, 2.5rem)`.
- Vertical rhythm in `--space-*` (4px base). Section breaks are `--space-9` (96px) on desktop.
- One full-bleed image hero per page, then a quiet papery section, then content.

### Imagery - colour vibe
Warm highlights, slightly lifted shadows. Think "sunny afternoon" not "Instagram filter". Greens lush and true, never teal-shifted. Skin tones natural - never orange, never desaturated. Mix close-up texture (cladding, ripples, dough) with mid-range activity shots. Full wide establishing shots are useful but shouldn't dominate. **Avoid** drone/aerial shots as a default, HDR processing, "closed for business" empty-site shots, and stock or AI imagery.

### Maps
The illustrated map (`assets/illustrations/map.png`) is a brand asset. **Always show it whole** - never zoom into or crop a region. It is hand-drawn, slightly imperfect - keep it that way.

---

## ICONOGRAPHY

Meadowbrook is **light on icons**. Most affordances live in photography and clear sentence-case labels. When icons appear:

- **Custom marks** - the **hand logo** and the **pool ring**, **bike-track badge**, **playing-fields cross** - are png assets in `assets/`. They're not part of a system; each belongs to its zone.
- **Generic UI glyphs** - search, close, arrow, menu, chevron - use **Lucide** via CDN (`https://unpkg.com/lucide-static@latest/icons/<name>.svg`) at **stroke 1.75**, currentColor. Lucide's soft-rounded stroke matches the brand better than Heroicons or Feather.
- **No emoji** as iconography. Never.
- **No unicode arrows** (`→`, `›`) inside buttons - use the Lucide `arrow-right` SVG. Inline within prose, an em-dash or arrow character is fine.
- **No inline SVG logos drawn by hand.** All distinctive marks live as files in `assets/`.

Icons inherit text colour. Icon-only buttons get a sentence-case `aria-label`.

---

## PROJECT INDEX

```
README.md                  ← you are here
SKILL.md                   ← agent skill entry point
colors_and_type.css        ← all CSS tokens + zone themes

assets/
  logos/
    hand.png               ← the DRA hand (sunny rays on green palm)
    bike-track-badge.png   ← orange bike-track block badge
  photos/
    hero.webp              ← full-site hero, summer day
    site.png               ← site without people, golden hour
    site-wide.png          ← wide street-view, summer
    brook.png              ← bluebells, woodland walk
    extravaganza-parachute.webp  ← kids under rainbow parachute
    extravaganza-sepia.png ← village fête / open-pool gathering
    bike-track.webp        ← BMX rider over the dirt jumps
    snooker-poster.png     ← existing snooker poster (reference)
  illustrations/
    map.png                ← hand-drawn site map (key brand asset)
    pool-icon.png          ← life-ring silhouette
    playing-fields-motif.png  ← white pitch corner-line on green
  textures/
    pool-tile.png          ← underwater mosaic tile photo (zone bg)

preview/                   ← design-system cards (auto-rendered)
ui_kits/
  meadowbrook-web/         ← marketing website kit
    README.md
    index.html             ← homepage demo
    components/*.jsx       ← Nav, Hero, ZoneCard, EventList, Footer, …
```

---

## SOURCES & PROVIDED MATERIALS

This system was built from:
- Brief and brand DNA written by the DRA (pasted in the project chat).
- 14 image uploads in `uploads/` - copied into `assets/`.
- Brand font files in `fonts/`: **Rexton** (Pool, full weight family), **Billiard** (Snooker), **Lobster** (the DRA).

No Figma file, no codebase, no existing CSS were provided. Where I made choices to fill gaps, they're flagged in this README and in the relevant component README.

## Font sources

| Family | Source | Used by |
|---|---|---|
| Plus Jakarta Sans | Google Fonts | Core body + UI, all zones |
| Abril Fatface | Google Fonts | Extravaganza |
| Oswald | Google Fonts | Playing Fields |
| Nunito | Google Fonts | Playground |
| Bebas Neue | Google Fonts | Bike Track |
| Josefin Sans | Google Fonts | Studio |
| Righteous | Google Fonts | Lounge |
| **Rexton** | Brand file (`fonts/Rexton-*.otf`) | Pool |
| **Billiard** | Brand file (`fonts/Billiard.otf`) | Snooker |
| **Lobster** | Brand file (`fonts/Lobster_1.3.otf`) | the DRA |
