# Meadowbrook Digital Raffle — Proof of Concept

A spec-driven build for a fully digital raffle at the DRA Extravaganza. Attendees scan a
QR code, land on a page on the Meadowbrook site, buy one or more entries, pay via Square,
and get a ticket number. On the day, an admin runs an independent draw for each prize.

This folder is the **spec set**. It's written to be handed to Claude Code (or any coding
agent) for spec-driven development: read the specs, build against them, check work against
the acceptance criteria.

## How to use this

1. Read `specs/00-overview.md` first — it sets scope and the decisions everything else assumes.
2. Feed the prompts in `PROMPTS.md` to Claude Code in order. Each references a spec file.
3. Build against acceptance criteria, not vibes. Each feature spec ends with a checklist.

## Assumed stack

- **Frontend / server:** existing Astro site, running in SSR/hybrid mode (`output: 'server'`),
  with API routes under `src/pages/api/`.
- **Backend host:** Google Cloud (Cloud Run assumed; a container running the Astro node adapter).
- **Database:** PostgreSQL (Cloud SQL). Drizzle ORM suggested for schema + migrations, but any
  query layer works — access is via a connection string so it's swappable.
- **Payments:** Square Web Payments SDK (client tokenisation) + Square Payments API (server),
  in **sandbox** mode for the POC.
- **Email (optional for POC):** Brevo, already in use for Meadowbrook.

## POC scope in one line

Prove the *digital* end-to-end flow — scan → enter → pay (sandbox) → ticket → admin draw —
convincingly enough that the events team can judge whether it feels authentic.

## Read this before building anything

`specs/06-transparency-and-compliance.md` — UK lottery law is not optional and going digital
may change which category you fall under. Flagged, not solved.
