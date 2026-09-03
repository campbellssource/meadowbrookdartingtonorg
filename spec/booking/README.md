# Meadowbrook Room Booking — replacing Acuity

A self-hosted replacement for the Acuity Scheduling subscription, built into the existing
Astro site. Bookers pick a room and a slot, pay by card, and get a magic link that lets them
amend or cancel without ever creating an account. The site owner keeps blocking rooms the way
they always have: by putting an event in Google Calendar.

This folder is the **spec set**, written in the same style as `spec/raffle/` so it can be
handed to Claude Code (or any coding agent) for spec-driven development.

## How to use this

1. Read `00-overview.md` first — it sets scope and the decisions everything else assumes.
2. Run `setup-gcp.sh` to create the infrastructure (see `08-infrastructure.md`).
3. Work through `IMPLEMENTATION-PLAN.md` phase by phase.
4. Build against the acceptance criteria at the end of each spec file, not vibes.

## Spec files

| File | Covers |
|---|---|
| `00-overview.md` | Scope, locked decisions, user flows, out of scope |
| `01-data-model.md` | Firestore collections, calendar event shape, the split between them |
| `02-availability-and-rules.md` | Opening hours, pricing, notice periods, slot generation |
| `03-booking-flow.md` | The book-a-room path, including the double-booking guard |
| `04-payments-and-refunds.md` | Square charge, refund on amend/cancel, failure handling |
| `05-manage-booking.md` | Magic links, local storage, amend time, amend duration, cancel |
| `06-emails.md` | Every transactional email, via Brevo |
| `07-admin-and-reporting.md` | Owner's booking list, income analysis, CSV export |
| `08-infrastructure.md` | GCP project, Firestore, service account, secrets, scheduler |
| `09-cutover-from-acuity.md` | Parallel run, migration of live bookings, killing the subscription |
| `10-terms.md` | Draft room hire terms for `/room-hire-terms` — needs committee sign-off |
| `11-local-development.md` | Running a full click-through on localhost without touching live data |
| `12-privacy-policy.md` | Privacy policy changes — plus two live inaccuracies found while checking |
| `13-door-access-integration.md` | The door-lock system that already reads these calendars |
| `14-ui-feedback.md` | Running list of UI notes, worked through in Phase 5b |
| `15-deployment.md` | What must be true before this reaches production, and in what order |
| `IMPLEMENTATION-PLAN.md` | Phased build order with file-level detail |
| `setup-gcp.sh` | Idempotent gcloud script for everything in `08` |
| `OPEN-QUESTIONS.md` | Things the DRA must decide or supply before launch |

## Assumed stack

Everything here is what the repo already runs — no new hosting, no new vendors.

- **Frontend / server:** existing Astro SSR site (`output: 'server'`, node adapter), API routes
  under `src/pages/api/`.
- **Host:** Cloud Run `meadowbrook-site`, `europe-west2`, project `meadowbrookdartington`.
- **Rooms / occupancy:** the three existing Google Calendars.
- **Booking records:** Firestore (Native mode) in a new dedicated project.
- **Payments:** Square — the same account that already powers `/donate`.
- **Email:** Brevo — the same account that already powers the newsletter.
- **Config:** Keystatic, extending the existing `facilities` collection.
