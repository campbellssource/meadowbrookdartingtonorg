# 07 — Admin and reporting

## Authentication

The raffle POC used a shared `ADMIN_SECRET`, and described itself as POC-grade. That is not
enough here: these pages show bookers' names, emails and phone numbers, and they can move
money. A shared secret gets pasted into WhatsApp, never rotates, and gives no answer to "who
issued that refund".

**Sign in with Google, restricted to the DRA Workspace.**

- OAuth 2.0 authorisation-code flow against the `meadowbrookdartington.org` Workspace.
- **Allowlist, not domain check.** `BOOKING_ADMIN_EMAILS`, comma-separated. Launch value:
  `michael.campbell@meadowbrookdartington.org`. A Workspace-domain check alone would admit
  every account the DRA ever creates, including shared and service mailboxes; an explicit list
  is one env var to edit and is auditable at a glance.
- Compare **case-insensitively** on the verified `email` claim, and require `email_verified`.
- An authenticated Google account that is not on the list gets a plain "no access" page, not a
  redirect loop back to sign-in — the single most confusing way to fail a login.
- Verify the ID token's signature, `aud`, `exp`, and `hd == meadowbrookdartington.org`. The
  `hd` claim is checked on the **verified token**, never on a value from the client.
- Session in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, 12-hour expiry.
- Every state-changing admin action writes the acting email into the booking's `history`.

This is a few hours of work and it is the difference between an audit trail and a shrug.

## `/admin/bookings`

The list the committee actually opens.

- Default view: upcoming bookings, all rooms, soonest first.
- Filters: room, date range, status, free-text on name / email / reference.
- Row: date and time, room, booker name, duration, price, status, payment state.
- Row expands to: full contact details, notes, payment ledger, amendment history, deep links
  to the Google Calendar event and to the Square payment.
- Actions: **resend confirmation**, **issue refund** (with an amount and a required reason),
  **cancel booking** (refund per policy), **add an internal note**.
- A booking flagged `needsReview` by reconciliation is visibly marked at the top of the list
  with what disagrees.

Money actions ask for confirmation and state the amount in cash before proceeding.

## `/admin/reporting`

Income analysis. The question the treasurer is actually asking is "what did the rooms earn,
and is it going up".

**Headline, for a chosen period (default: last 12 months):**

- Gross booked, refunded, net.
- Booking count, cancellation count and rate.
- Average booking value and average duration.

**Breakdowns:**

- Net revenue by room by month — a grouped bar chart, one series per room.
- Occupancy: booked hours as a percentage of available opening hours, by room by month. This
  is the number that tells you whether to raise a price or market a room, and it is the one
  Acuity does not give you.
- Day-of-week and time-of-day heatmap per room — where the demand actually is.
- Lead time distribution: how far ahead people book.
- Repeat bookers: count of email addresses with more than one booking, and their share of
  revenue. If that share is large, the recurring-bookings feature deferred in `00` has a
  number attached to it.

**Exports:**

- CSV of bookings for any period, one row per booking, with the payment ledger flattened —
  the treasurer's file.
- CSV of the payment ledger alone, for reconciling against a Square statement.

**Square reconciliation view:** any booking whose ledger disagrees with Square's current
payment status, per `04`. Empty is the healthy state.

### Computing it

At current volume, reading every booking in the period and aggregating in memory is correct
and fast. Do that. No pre-aggregation, no counters, no scheduled rollups — they would be three
more things to keep in sync for a dataset that fits comfortably in a request.

Revisit if a report ever takes more than a couple of seconds, which at a few thousand bookings
a year it will not.

## Charts

Follow the site's existing visual language. Charts must be readable in the site's own palette,
have real axis labels, and never rely on colour alone to distinguish series. Tables carry the
numbers; charts carry the shape. Every chart has the underlying table available beneath it.

## Privacy

The admin pages are the main place personal data is on screen.

- `Cache-Control: no-store` throughout.
- No booker PII in analytics, error reports or log lines. Log booking references.
- The CSV export downloads over an authenticated request; it is never written to a public path
  or a bucket.
- Retention: bookings older than **7 years** (the charity's financial-records horizon) are
  candidates for anonymisation — strip name, email and phone, keep room, times and money so
  the historical reporting stays intact. Ship the script in v1 even if it isn't scheduled yet,
  and cover it in the privacy policy.

## Acceptance criteria

- [ ] A non-Workspace Google account cannot reach any `/admin` page.
- [ ] A Workspace account not in `BOOKING_ADMIN_EMAILS` cannot reach any `/admin` page.
- [ ] An expired session redirects to sign-in and returns to the intended page afterwards.
- [ ] Every admin-issued refund or cancellation records the acting email in the booking history.
- [ ] Reporting totals match the sum of the CSV export for the same period.
- [ ] Occupancy accounts for actual opening hours, not a flat 24 hours.
- [ ] Refunded bookings are excluded from net revenue but present in the booking count.
- [ ] The Square reconciliation view is empty on a healthy dataset and lists a deliberately mismatched booking.
- [ ] No admin page appears in `sitemap.xml` or is indexable.
