# Meadowbrook Dartington

Astro-based website for Meadowbrook and the Dartington Recreation Association.

## Stack

- **[Astro](https://astro.build/)** — static site framework
- **[Keystatic](https://keystatic.com/)** — git-based CMS (local mode), accessible at `/keystatic`
- **[Acuity Scheduling](https://acuityscheduling.com/)** — embedded booking widget for bookable facilities

## Development

```bash
npm install
npm run dev      # dev server + Keystatic CMS
npm run build    # production build
npm run preview  # preview production build
```

## Content Management

Content is managed via Keystatic at `/keystatic` during local development. All content is stored as YAML files in `src/content/`.

### Collections

| Collection | Path | Notes |
|---|---|---|
| Pages | `src/content/content-pages/` | General content pages |
| Facilities | `src/content/facilities/` | Each facility has a type: bookable, link, or generic |
| Misc pages | `src/content/misc-pages/` | Privacy policy etc. |
| Partners | `src/content/partners/` | "In partnership with" logos on homepage |
| With thanks to | `src/content/supporters/` | Supporter logos on homepage |

### Singletons

| Singleton | Path | Notes |
|---|---|---|
| Homepage | `src/content/homepage.yaml` | Hero heading, about preview, banners, partners intro |

## Facility Types

Each facility has one of three types, set in Keystatic:

- **Bookable** — embeds an Acuity Scheduling widget. Requires a `bookingCategory` that matches exactly in Acuity (e.g. `Snooker`, `Studio - Large room`, `Lounge - Small room`).
- **Link** — links out to an external website (e.g. Pizzalogica, Things Happen Here). Opens in a new tab.
- **Generic** — a standard content page with intro and body text.

## Room Booking

Bookable facilities embed the Acuity widget via `AcuityBooking.astro`:

```astro
<AcuityBooking category="Studio - Large room" />
```

Current booking categories: `Studio - Large room`, `Lounge - Small room`, `Snooker`

## Project Structure

```
public/
├── assets/          # Photos, illustrations, logos, textures
├── fonts/           # Brand fonts (Rexton, Billiard, Lobster)
├── images/
│   ├── facilities/  # Facility card images (600×750px WebP recommended)
│   ├── partners/    # Partner logos
│   └── supporters/  # Supporter logos
└── styles/
    └── global.css   # Design tokens, zone themes, all component styles
src/
├── components/
│   └── AcuityBooking.astro
├── content/         # All CMS content (YAML + mdoc files)
├── layouts/
│   └── Layout.astro # Main layout with nav, mobile menu, footer
├── lib/
│   └── zones.ts     # Maps facility slugs to zone CSS class names
└── pages/
    ├── facilities/
    │   ├── index.astro
    │   └── [slug].astro
    ├── index.astro
    ├── about.astro
    ├── contact.astro
    └── content/[slug].astro
```

## Design System

Styles live in `public/styles/global.css`. Each facility has a **zone theme** — a unique colour palette and typography style applied via a CSS class (e.g. `.zone-pool`, `.zone-snooker`). The mapping from facility slug to zone class is in `src/lib/zones.ts`.

Facility card images should be **600×750px** (4:5 ratio), WebP format, under ~150KB.
