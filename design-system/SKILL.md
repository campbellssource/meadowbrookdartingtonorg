---
name: meadowbrook-design
description: Use this skill to generate well-branded interfaces and assets for Meadowbrook + the DRA (Dartington Recreation Association), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

# Meadowbrook + the DRA - design skill

Meadowbrook is the recreational heart of Dartington - community building, pool, playground, fields, bike track, bar. The DRA (Dartington Recreation Association) is the charity that runs it. The brand is a **chameleon**: a calm papery core that steps back so the zones (Pool, Snooker, Bike Track, Playground, etc.) can shine.

## How to use this skill

1. **Read `README.md`** first - it has the full brand DNA, voice, visual foundations, iconography rules.
2. **Pull tokens from `colors_and_type.css`** - every colour, font, radius, shadow, zone theme is in there. Drop the file in and use the CSS custom properties. Apply `.zone-pool`, `.zone-bike`, etc. on a section root to switch theme.
3. **Use the real assets in `assets/`** - the hand logo, the hand-drawn map, the pool-tile texture, the photography. Don't invent new SVG logos or generate imagery; copy these files out.
4. **For interface work, look at `ui_kits/meadowbrook-web/`** - homepage, nav, zone cards, event list, footer are all factored into JSX components.
5. **Follow the voice** - sentence case, warm and direct, optimistic but grounded, short headlines. "We" = the community. No emoji.

## When invoked without other guidance

Ask the user what they want to build (poster? website section? slide? booking flow?), confirm which **zone** it belongs to (or "core Meadowbrook"), then output an HTML artifact or production code.

## Key creative constraints

- No 1px borders. No dividers. Use background shifts and spacing.
- Photography over illustration. Hand-drawn map is the one big illustration.
- Generous radii, soft shadows used sparingly.
- Sentence case everywhere except proper nouns.
- Headlines 2–4 words. Body copy short.
- No bluish-purple gradients, no emoji cards, no AI imagery.
