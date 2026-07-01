# Raffle POC — Implementation Plan (adapted to this repo)

This plan realises `spec/raffle/*` against the **actual** Meadowbrook Astro repo. It replaces
the spec's two biggest infra assumptions — Postgres/Drizzle and a fresh Square integration —
with patterns this repo already uses.

## Key adaptations vs the spec

| Spec assumes | This repo already has | Decision |
|---|---|---|
| Switch Astro to SSR | Already `output: 'server'` + node adapter | **Nothing to do** |
| Postgres (Cloud SQL) + Drizzle | Google Sheets via service account (`leaflet-sheet.ts`) | **Use a Google Sheet** — one spreadsheet, tabbed |
| Square Web Payments SDK, new env vars | `donate.astro` + `api/donate.ts` already do Square | **Reuse existing Square pattern + env vars** |
| Brevo email (optional) | Brevo already used in `lib/leaflet` | Reuse if we do the email flag |
| `specs/` folder | specs live in `spec/raffle/` | Paths adjusted |

### Google auth (managed-domain reality)
The `meadowbrookdartington.org` Workspace **blocks the Sheets OAuth scope on user consent AND
blocks service-account key downloads** (`iam.disableServiceAccountKeyCreation`). So auth is:
- **Local dev:** impersonate a dedicated SA via your gcloud ADC. Created
  `raffle-sheet@calendartopasscode.iam.gserviceaccount.com`, enabled IAM Credentials API,
  granted your account `roles/iam.serviceAccountTokenCreator` on it. Set
  `RAFFLE_IMPERSONATE_SA` in `.env`; the sheet is shared with that SA (Editor). ✅ working.
- **Production (Cloud Run):** runs as the site's runtime SA
  `589136616970-compute@developer.gserviceaccount.com` (same one the leaflet sheet uses).
  `RAFFLE_IMPERSONATE_SA` is unset there. **TODO before deploy: share the raffle sheet with
  `589136616970-compute@developer.gserviceaccount.com` (Editor).**

Resolution order in `raffle-sheet.ts`: `GOOGLE_SERVICE_ACCOUNT_JSON` → `RAFFLE_IMPERSONATE_SA`
(impersonate via ADC) → plain ADC.

### Env var reconciliation
Reuse the repo's existing names (do **not** introduce the spec's `SQUARE_ENV` / `SQUARE_APP_ID`):
- Client: `PUBLIC_SQUARE_APPLICATION_ID`, `PUBLIC_SQUARE_LOCATION_ID`, `PUBLIC_SQUARE_ENVIRONMENT`
- Server: `SQUARE_ACCESS_TOKEN`
- Sheets: `GOOGLE_SERVICE_ACCOUNT_JSON` (already used by leaflet)

**New** vars this build adds:
- `RAFFLE_SHEET_ID` — the raffle spreadsheet
- `RAFFLE_PRICE_PENNIES` (**`100` — £1 per ticket**, fixed; all tickets same price by law)
- `ADMIN_SECRET` — POC-grade admin guard
- `EXCLUDE_PREVIOUS_WINNERS` (default `true`)
- `SEND_CONFIRMATION_EMAIL` (default `false`)

**Square environment — LOCKED: isolated raffle creds.** `PUBLIC_SQUARE_ENVIRONMENT` stays
`production` for live donations; the raffle uses its **own** sandbox vars so the two never
collide: `PUBLIC_RAFFLE_SQUARE_APPLICATION_ID`, `PUBLIC_RAFFLE_SQUARE_LOCATION_ID`,
`PUBLIC_RAFFLE_SQUARE_ENVIRONMENT` (=`sandbox`), `RAFFLE_SQUARE_ACCESS_TOKEN` (server-only).
The raffle pay code is a copy of `api/donate.ts`'s pattern reading these raffle-scoped vars.

**API paths — LOCKED: `/api/raffle/*`.** All raffle endpoints namespace under `/api/raffle/`
(`entry`, `pay`, `draw`) rather than the spec's flat `/api/pay` — avoids clashing with the
repo's existing flat `/api/*` files.

## Legal — small society lottery (category DECIDED)

The raffle runs as a **small society lottery** (Gambling Commission), not an incidental lottery.
Ref: https://www.gamblingcommission.gov.uk/public-and-players/guide/page/licences-for-small-society-lotteries

**Committee action (not code):** a small society lottery must be **registered with the local
licensing authority** (the council — South Hams District Council) before selling any tickets;
there's a lead time, plus post-event return obligations. Flagged for DRA; outside this build.

**Build requirement — every ticket MUST show these four things** (this is code, not just
governance). The digital "ticket" = the confirmation screen, each `/entries` context, and the
optional Brevo email. All four must appear wherever a ticket/receipt is presented:

1. **Name of the society** — Dartington Recreation Association
2. **Ticket price** — £1 (same for all tickets)
3. **Name and address of the organiser** — Dartington Recreation Association,
   Meadowbrook, Shinners Bridge, Dartington, TQ9 6JD
4. **Date of the draw** — 11 July 2026

Implementation: put these in one config block in `src/lib/raffle.ts`
(`SOCIETY_NAME`, `TICKET_PRICE_LABEL`, `ORGANISER_NAME`, `ORGANISER_ADDRESS`, `DRAW_DATE`) and
render a shared "ticket legal footer" component on `/raffle`, `/raffle/thanks`, and in the email.

## Branding — Extravaganza micro-brand (this raffle is Extravaganza-only)

The raffle exists solely for the 2026 Extravaganza, so it uses the event's **festival
micro-brand**, not the default paper/green site style. That brand is already defined and
proven in `src/pages/calendar/extravaganza2026.astro` + `public/styles/global.css`:

- Activate it by passing `bodyClass="zone-extravaganza"` to `Layout` (sets `--bg` festival
  orange `#F47B1F`, `--bg-deep #DD680F`, white foreground).
- **Typography:** Poppins 800, uppercase, tight tracking for the wordmark/headings.
- **Fixtures to reuse:** bunting bands top & bottom (`.ex-bunt-band` + `--bunt-*` pennants),
  the `.ex-stamp` hand-mark logo, `.ex-wordmark` for the page title (e.g. "Raffle"), the
  polaroid motif for prize/photo framing, and `--sun (#F9D21E)` yellow for primary buttons.
- **Accessibility gotcha (already solved on the event page):** on festival orange, sun-yellow
  and sky-blue text **fail WCAG AA**; use `--ink (#28201A)` for text/links that need contrast
  (e.g. body copy, links, button labels on yellow). The form fields, price, live total, ticket
  numbers, and consent copy must all clear AA against the orange field — reuse the event page's
  ink-on-orange choices rather than re-deriving them.

Practically: `/raffle`, `/raffle/thanks`, and `/entries` all render inside
`bodyClass="zone-extravaganza"` with bunting, the wordmark title, and sun-yellow CTAs, so they
feel like part of the Extravaganza page. `/admin` can stay plain (operator-facing, not public).

## Data model in Google Sheets

Sheets is **not relational or transactional**, so the spec's 5 tables collapse into 4 tabs,
with entrant fields **denormalised** onto the rows that need them (avoids cross-tab joins).
Same concurrency caveat as `leaflet-sheet.ts` — acceptable for a village-scale POC, flagged below.

**Tab `Prizes`** — hand-editable by the events team.
`id | name | description | donor | display_order`

**Tab `Payments`** — one row per attempt; also the entrant + consent record + idempotency key.
`payment_id (uuid) | entrant_name | entrant_email (lc) | entrant_phone | consent_at | quantity | amount_pennies | currency | status (pending|completed|failed) | square_payment_id | created_at`

**Tab `Entries`** — the pool. Denormalised so the draw, public list, and winner contact need no join.
`ticket_number (MB-0042) | entrant_name | entrant_email (lc) | entrant_phone | payment_id | created_at`

**Tab `Draws`** — one row per drawn prize.
`prize_id | prize_name | winning_ticket | winner_name | winner_email | pool_size | method | drawn_by | drawn_at`

Tabs auto-initialise their header row on first use (mirrors `ensureHeader()` in leaflet-sheet).

### Where Sheets forces a compromise (flagged honestly)
- **Gapless, race-safe ticket numbers** → best-effort: `MB-` + zero-padded (max existing +1).
  Two simultaneous mints could collide; rare at this scale, same risk class the leaflet drop accepts.
- **Atomic mint-in-one-transaction** → replaced by a single batch append of all `Entries` rows
  followed by the payment-status update; if Square succeeds but the Sheets write fails we **log
  loudly** (spec's explicit requirement) rather than silently drop.
- **Idempotency** → `payment_id` is the Square idempotency key AND we refuse to re-mint if the
  Payments row is already `completed` (return the existing tickets). Covers ret/double-submit.

## Files to create

**Data + config**
- `src/lib/raffle.ts` — config constants (price, flags), types, ticket formatting, admin-guard helper.
- `src/lib/raffle-sheet.ts` — Sheets data layer modelled on `leaflet-sheet.ts`:
  `getPrizes`, `createPendingPayment`, `getPayment`, `completePaymentAndMintEntries`,
  `getPublicEntries`, `getTotals`, `getDraws`, `eligiblePool`, `recordDraw`.
- `scripts/seed-raffle-prizes.mjs` — seed a few sample prizes (analog to existing scripts).

**Public flow**
- `src/pages/raffle/index.astro` — `/raffle`: `bodyClass="zone-extravaganza"`, bunting + wordmark,
  intro tying it to the Extravaganza, prizes, price, live total, form + Square card element
  (reuse donate.astro's client SDK code), "how the draw works" section. Ink-on-orange for AA.
- `src/pages/api/raffle/entry.ts` — form submit → create/refresh pending Payment, return `paymentId`.
- `src/pages/api/raffle/pay.ts` — recompute amount server-side, Square `CreatePayment`
  (idempotency = paymentId), on success mark completed + mint entries, return ticket numbers.
- `src/pages/raffle/thanks.astro` — confirmation (ticket numbers large; link to /entries).
- `src/pages/entries.astro` — `/entries`: ticket + first name only, totals, ordered.
- `src/lib/raffle-email.ts` *(optional)* — Brevo confirmation behind `SEND_CONFIRMATION_EMAIL`.

**Admin**
- `src/pages/admin/index.astro` — `/admin`: totals + prizes w/ draw status + Draw buttons (guarded).
- `src/pages/api/raffle/draw.ts` — POST `{prizeId}`: refuse redraw, build eligible pool,
  `crypto.randomInt` select, append Draws row, return winner + pool size.

(Admin routes guarded by an `ADMIN_SECRET` check in `src/lib/raffle.ts`, reused by page + API.)

## Build order (maps to PROMPTS.md 1→6)

1. **Data layer** — `raffle.ts` + `raffle-sheet.ts` + Prizes tab + seed. *(replaces "DB/Drizzle")*
2. **Entry page** — `/raffle` + `/api/raffle/entry` (pending payment, no entries yet).
3. **Square pay** — `/api/raffle/pay` + client card element + mint entries.
4. **Confirmation + transparency list** — `/raffle/thanks` + `/entries` (+ optional email flag).
5. **Admin + draw** — `/admin` + `/api/raffle/draw` + secret guard.
6. **Transparency polish** — "how the draw works" copy + method/pool-size on the admin reveal.

1→2→3 gives a working paid entry; 4 makes it trustworthy; 5 makes it drawable.

## Acceptance-criteria deltas (Sheets vs Postgres)
- "Schema migrates cleanly on empty Postgres" → **N/A**; replaced by auto-header tab init.
- "Ticket numbers gapless & race-safe" → **best-effort** (concurrency caveat).
- "Single query returns eligible pool" → read `Entries`, filter in code by `Draws` winners.
- All other criteria (server-side amount, no double charge, declined = no tickets, secret-gated
  admin, no personal data on /entries, crypto.randomInt, no silent redraw) are **fully met**.

## Out of scope (unchanged from spec)
Live Square keys, refunds/webhooks, production admin auth, bulk email. Lottery **category is now
decided** (small society lottery — see above); the remaining committee task is **registering with
the council** and meeting return obligations — governance, not code. The mandatory ticket info,
however, **is** in scope and built into the ticket footer.
