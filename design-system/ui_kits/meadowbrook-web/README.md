# Meadowbrook web kit

A click-through marketing-site prototype demonstrating the core Meadowbrook design system: nav, hero, zone grid, event list, pool-campaign banner, map block, footer — plus a generic zone-page template that re-themes on the same layout chassis (showing the chameleon principle).

## Run

Open `index.html`. No build step. It loads `colors_and_type.css` from the project root.

## Files

```
index.html              ← the prototype shell + router
app.jsx                 ← React app, page state, layouts
components/
  Nav.jsx
  Hero.jsx
  ZoneGrid.jsx
  EventList.jsx
  PoolCampaign.jsx
  MapSection.jsx
  Footer.jsx
  ZonePage.jsx          ← re-themed zone template
  ui.jsx                ← Button, Chip, Eyebrow, Icon primitives
```

## What it covers

- **Homepage**: hero photo, intro, zone grid, what's-on list, pool-campaign banner, map, footer.
- **Zone page**: same chassis re-themed via `.zone-*` classes — try Bike Track, Pool, Snooker.
- **Donate page**: pool-restoration support flow stub.

## What it does *not* cover

Real booking, real auth, server-side anything. Components are cosmetic recreations only.

## Substitutions

Pool uses **Lilita One** (sub for Rextron, not on Google Fonts).
Snooker uses **Yeseva One** (sub for Billiards, not on Google Fonts).
Both flagged in the root `README.md` and root `colors_and_type.css`.
