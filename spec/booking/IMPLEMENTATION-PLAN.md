# Implementation plan

Seven phases. Each ends somewhere shippable, and each is small enough to review in one sitting.
Phases 1–5 can all sit behind a flag while Acuity keeps running.

## Phase 0 — Infrastructure

`./spec/booking/setup-gcp.sh` plus the manual steps it prints. See `08-infrastructure.md`.

**Done when:** a scratch Node script, run locally, lists busy blocks from all three calendars
and writes then reads a document in Firestore — using ADC impersonation, with no key file.

That end-to-end check is the whole point of the phase. The calendar share is the step most
likely to be missed, and it fails silently by making every room look free.

## Phase 1 — Rules and availability, read-only ✅ DONE 31 Aug 2026

No writes, no money. The riskiest logic in the system, built where it can't hurt anyone.

| File | Purpose |
|---|---|
| `src/lib/google-auth.ts` | Credential resolution, per `08` |
| `src/lib/booking-config.ts` | Read room config out of Keystatic content |
| `src/lib/booking-time.ts` | `Europe/London` ↔ UTC, slot grids, DST handling |
| `src/lib/booking-pricing.ts` | `priceFor(room, start, end)` — pure |
| `src/lib/booking-calendar.ts` | `freebusy.query`, event CRUD |
| `src/lib/booking-availability.ts` | Compose the above into slots |
| `src/pages/api/booking/availability.ts` | The endpoint |
| `keystatic.config.ts` | The `booking` config block |

Also: the three facility YAMLs gain their `booking` block, using real prices and hours from
`OPEN-QUESTIONS.md` items 1–5.

**Tests, and this is where the unit tests earn their keep:** pricing across a peak boundary;
slot generation on both 2027 BST transition days; buffer inflation; notice and advance windows;
a closed day; a fully booked day.

**Done when:** `/api/booking/availability` returns slots for a fortnight that reconcile with
what Acuity shows, for all three rooms:

- **Snooker must match exactly.** No buffer, no notice, same hours — any difference is a bug.
- **Studio and Lounge will differ, and should.** The new 30-minute buffer is stricter than what
  Acuity enforces today (`02`), so our availability will be a strict subset. Every difference
  must be *explained by the buffer*. A difference the buffer does not explain is a bug.

Stating it this way because the original criterion — "match Acuity" — would have failed a
correct implementation and sent someone hunting a fault that wasn't there.

**Status.** Built and verified against the live calendars. 75 unit tests; `/booking-preview`
renders the engine for checking by eye. Studio on 3 Sep 2026 offers 15:30 as the last start
before the 17:00 booking (one hour, ending exactly on the buffer edge), nothing until 21:30
after the 19:15–21:00 booking, and 22:00 for the final hour. Snooker and Lounge 57 starts that
day, Studio 34.

**The Acuity side-by-side was dropped, 31 Aug 2026**, at the DRA's direction: Acuity's rules are
arbitrary and not a specification worth conforming to. The rules we implement are the DRA's
stated ones, tested directly (75 unit tests) rather than by comparison. Snooker would have
matched; Studio and Lounge never would have, because the 30-minute buffer is deliberately
stricter than Acuity's 15.

## Phase 2 — Booking, paid ✅ DONE 1 Sep 2026 (sandbox)

The write path from `03` and the charge from `04`.

| File | Purpose |
|---|---|
| `src/lib/booking-store.ts` | Firestore access; the overlap transaction |
| `src/lib/booking-square.ts` | Charge, refund, idempotency |
| `src/lib/booking-email.ts` | Templates and Brevo transactional send |
| `src/lib/booking-ref.ts` | Reference generation |
| `src/pages/api/booking/create.ts` | The ten steps in `03` |
| `src/components/BookingWidget.astro` | The booking UI |
| `src/pages/bookings/[ref].astro` | Confirmation page |
| `src/pages/facilities/[slug].astro` | Widget replaces `AcuityBooking`, behind a flag |

Square in **sandbox** throughout this phase.

**Done when:** a sandbox booking produces one payment, one Firestore record, one calendar
event and one email — and two concurrent attempts at the same slot produce one 201, one 409,
and exactly one charge. Write that concurrency test; it is the reason the transaction exists.

**Status.** A full click-through completed in the browser on 1 Sep 2026: slot picked, sandbox
card paid, confirmation shown. The booking produced one Square payment, one Firestore record
(`status: confirmed`, one payment entry), one `[TEST EVENT]` calendar event parseable by the
door system, and two emails. Cleanup removed all of it; both collections are empty. 129 unit
tests, plus the 8-way concurrency check against real Firestore.

**And then, before anyone is told the form exists:** a real booking, real card, real money, on
production Square credentials — with **both a Visa and a Mastercard** — cancelled afterwards to
prove the refund. `/donate` needed significant post-launch work because the sandbox did not
reproduce 3-D Secure behaviour, and Visa failed where Mastercard worked (`04`). Sandbox green is
not evidence. £7.50 buys the certainty.

## Phase 3 — Manage: magic links, amend, cancel

Everything in `05`, and the refund half of `04`.

| File | Purpose |
|---|---|
| `src/lib/booking-token.ts` | Sign, verify, revoke |
| `src/lib/booking-policy.ts` | `refundFor()` — pure, exhaustively tested |
| `src/pages/api/booking/amend.ts` | Time and duration, one operation |
| `src/pages/api/booking/cancel.ts` | |
| `src/pages/api/booking/find.ts` | Lost-link flow |
| `src/pages/bookings/[ref]/amend.astro` | |
| `src/pages/bookings/[ref]/cancel.astro` | |
| `src/pages/bookings/find.astro` | |
| `src/pages/bookings/index.astro` | Local-storage "your bookings" |

**Done when:** every acceptance criterion in `05` passes, including the failure cases — a
failed amend-up charge changing nothing, and a failed refund leaving the slot held.

## Phase 4 — Owner admin

`07`. Google sign-in first — it gates everything else in the phase.

| File | Purpose |
|---|---|
| `src/lib/booking-admin-auth.ts` | OAuth, `hd` check, allowlist, session |
| `src/pages/admin/auth/*` | Sign-in and callback |
| `src/pages/admin/bookings.astro` | The list |
| `src/pages/admin/reporting.astro` | Income analysis |
| `src/pages/api/admin/booking/*` | Refund, cancel, note, resend |
| `src/pages/api/admin/export.ts` | CSV |

**Done when:** a non-allowlisted Workspace account is refused, every money action is attributed
in `history`, and reporting totals reconcile against the CSV for the same period.

## Phase 5 — Scheduled jobs and webhooks

| File | Purpose |
|---|---|
| `src/lib/booking-oidc.ts` | Verify Cloud Scheduler's OIDC tokens |
| `src/pages/api/booking/cron/reminders.ts` | 24-hour reminders |
| `src/pages/api/booking/cron/reconcile.ts` | The table in `01` |
| `src/pages/api/booking/webhooks/square.ts` | Orphan recovery, ledger truth |

**Done when:** both jobs run on schedule and are idempotent; a request without a valid OIDC
token is rejected; a deliberately orphaned payment is recovered or refunded, with an alert.

## Phase 5b — UI polish

Collected feedback on the booking flow, batched and worked through in one pass. See
`14-ui-feedback.md`, which is also where notes should be added as they come up.

Separate from Phase 6 because it has a different reviewer: the DRA looking at it, rather than a
test suite. Deliberately **before** the accessibility pass, so that pass audits the final shape
rather than one that is about to change.

Bugs do not wait for this phase — anything broken or misleading is fixed when found.

**Done when:** every note in `14` is done or explicitly declined, and the flow has been driven
on a real phone.

## Phase 6 — Hardening

Not optional, and easier to schedule as its own phase than to squeeze into the others.

- **Accessibility.** Full keyboard path through the booking flow, a screen-reader pass on the
  date and slot pickers, visible focus, colour contrast. The current Acuity iframe is
  effectively unauditable — replacing it is a chance to be better, not merely equivalent.
- **No-JS.** Slot browsing works without JavaScript; card entry says plainly that it needs it.
- **Rate limits** on `create`, `find` and token use.
- **Load check** — a few hundred concurrent availability requests, to see the cache work.
- **`Referrer-Policy`, `Cache-Control: no-store`, CSP** on all `/bookings/*` and `/admin/*`.
- **Log audit** — confirm no token and no booker PII appears in any log line.
- **Run `/security-review`** over the whole branch. This handles money and personal data.

## Phase 7 — Cutover

`09-cutover-from-acuity.md`. Do the Acuity calendar-sync test *first*.

---

## Notes for whoever builds this

**Follow the repo's existing patterns rather than inventing new ones.** `api/donate.ts` is the
Square reference. `lib/leaflet-sheet.ts` is the Google-auth reference. `raffle-email.ts` on
`raffle-feedback-1` is the Brevo transactional reference. The house style is small focused
modules under `src/lib/`, thin API routes under `src/pages/api/`, and comments that explain
*why* rather than *what* — the existing files do this well and are worth reading first.

**Pure functions where the money is.** `priceFor`, `refundFor` and the slot generator take
values and return values. Everything that can be tested without a network should be.

**The two invariants worth repeating:**
1. The calendar decides whether a room is free. Never compute availability from Firestore alone.
2. The server prices. A price from a client is a log line, never an input.

## Phase 8 — Calendar PII purge (deferred)

Deferred by the DRA on 31 Aug 2026, and not a launch blocker. Nothing currently removes personal
detail from calendar event descriptions — the existing `calendartopasscode` cleanup handles
Google Contacts only (`13`). Until this is built, the privacy policy states criteria rather than
a retention period (`12`).

A job that walks room-calendar events older than some agreed age and rewrites `summary` and
`description` to remove the name, phone number and email, leaving the occupancy block and the
booking reference intact.

**Must never delete an event.** The door system reacts to cancellations, so a delete would look
like one. Rewrite only.

Open when this is picked up: whether it lives here or in `calendartopasscode` (`13`), and the
one-off backfill for events already on the calendars — the oldest are around four months back.

**Done when:** an event older than the cutoff carries no name, phone or email; its times and
booking reference are unchanged; the job is idempotent; and re-running it changes nothing.
