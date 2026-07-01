# Prompts for Claude Code

Paste these in order. Each assumes the `specs/` folder is in the repo. Run one, review the
diff against the spec's acceptance criteria, then move on. Adjust paths to match your repo.

---

## 0 — Orientation (run once)

```
Read every file in ./specs, starting with 00-overview.md. This is a spec-driven build for a
digital raffle bolted onto our existing Astro site. Don't write code yet. Summarise back to me:
the flow, the locked decisions, the data model, and anything in the specs that's ambiguous or
that conflicts with how this Astro repo is currently set up. Ask me about anything unclear
before we start.
```

---

## 1 — Project setup & database

```
Following specs/00-overview.md and specs/01-data-model.md:

- Switch the Astro site to SSR/hybrid so we can have API routes and server logic (output:
  'server' with the node adapter), without breaking existing static pages.
- Add Postgres access via a DATABASE_URL connection string. Use Drizzle ORM.
- Implement the full schema from 01-data-model.md: entrants, payments, entries, prizes, draws,
  plus a gapless MB- ticket-number sequence and the public_entries / entry_counts helpers.
- Write a migration and a seed script that inserts a few sample prizes.

Meet every acceptance criterion at the bottom of 01-data-model.md. Show me the schema and the
migration before applying it.
```

---

## 2 — Entry page

```
Following specs/02-entry-flow.md, build GET /raffle:

- Lists prizes from the DB (ordered), shows price per entry from config, and the entry form
  (name, email, phone, quantity 1–20, consent checkbox) with a live total.
- On submit: validate, create-or-reuse the entrant (dedupe by lowercased email), record
  consent_at, create a pending payment row, then advance to the payment step. Do NOT mint
  entries yet.
- Mobile-first — most people will scan a QR on their phone. Match the existing Meadowbrook
  site styling.

Hit every acceptance criterion in 02-entry-flow.md. Don't put any personal data in URLs.
```

---

## 3 — Square sandbox payment

```
Following specs/03-payments-square.md, add Square sandbox payments:

- Client: load the Square Web Payments SDK (sandbox), render the card element, tokenise to a
  sourceId. Never send raw card data.
- Server: POST /api/pay. Recompute the amount server-side (quantity × RAFFLE_PRICE_PENNIES),
  call Square CreatePayment with GBP and an idempotency key (the paymentId), and on success
  mark the payment completed and mint `quantity` entries with fresh ticket numbers — all in one
  DB transaction. On failure, mint nothing and return a clear error. Return the ticket numbers.
- Read all Square config from env. The access token must stay server-side only.

Verify against the acceptance criteria in 03-payments-square.md, including: server-side amount,
idempotency (no double charge / double tickets), and declined-card path. Tell me exactly which
sandbox env vars I need to set.
```

---

## 4 — Confirmation & public entries list

```
Following specs/04-confirmation.md:

- Post-payment confirmation showing the ticket number(s) large and clear, restating that the
  entry is in every prize draw, with a link to /entries.
- GET /entries: public list of every entry (ticket number + first name only — no email/phone),
  plus totals (entries, entrants), ordered by ticket number.
- Add a Brevo confirmation email behind a SEND_CONFIRMATION_EMAIL flag, OFF by default.

Meet the acceptance criteria in 04-confirmation.md. Make sure no contact details leak onto
/entries.
```

---

## 5 — Admin dashboard & draw

```
Following specs/05-admin-and-draw.md:

- Guard /admin/* with a shared secret from ADMIN_SECRET (POC-grade — label it as such in code).
- GET /admin: totals (entries, entrants, pennies raised) and a list of prizes with draw status
  and a Draw button per undrawn prize.
- POST /api/admin/draw { prizeId }: refuse if already drawn; build the eligible pool honouring
  EXCLUDE_PREVIOUS_WINNERS (default true, so nobody wins twice); pick with crypto.randomInt (NOT
  Math.random); record a draws row with winning_entry_id, pool_size, method, drawn_by, drawn_at,
  atomically; return the winner + pool size. Handle an empty pool cleanly.
- The winner reveal should be clear and unhurried, showing the ticket number, name, and "drawn
  from N entries". Leave room to add an animation later.

Satisfy every acceptance criterion in 05-admin-and-draw.md — especially: no silent redraw, no
person winning twice when the flag is on, and crypto.randomInt as the selector.
```

---

## 6 — Transparency polish (optional for POC)

```
Following specs/06-transparency-and-compliance.md, add the transparency touches: show the draw
method and pool size on the admin reveal and store them (already in the draws table), and add a
short plain-English "How the draw works" section to /raffle explaining the entries list and the
cryptographic random selection. Do NOT touch the legal/compliance checklist — that's a committee
task, not code.
```

---

## Notes for whoever runs these

- The compliance section (06) is a real blocker for a real event, not a code task. Sort the
  Gambling Commission / local-authority question before selling anything for real.
- The whole POC is Square **sandbox** — no real money moves. Don't wire live keys until the
  team has signed off on the concept and the legal side is clear.
- Build order matters: 1 → 2 → 3 gives you a working paid entry; 4 makes it trustworthy; 5 makes
  it drawable. That's the full demo.
```
