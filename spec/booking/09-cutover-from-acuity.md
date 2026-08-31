# 09 — Cutover from Acuity

The risk here is not the code. It is the bookings that already exist, and the fact that
somebody has paid for them.

> **Updated 31 Aug 2026 — the DRA will run both systems in parallel** rather than cutting over,
> keeping Acuity live while the new system takes real bookings. That removes most of the risk
> this file was written to manage, and it is the right call.
>
> Two things it does **not** remove, and one it adds:
>
> - **The disconnection question below still has to be answered**, just later — on the day
>   Acuity is finally switched off, not before launch.
> - **Double-booking across the two systems is now the live risk.** Both write to the same three
>   calendars, and the new system treats every calendar event as occupancy (D1), so an Acuity
>   booking correctly blocks a Meadowbrook one. **The reverse is the danger:** whether Acuity
>   respects events *it* did not create depends on its own busy-time settings. If it does not,
>   two people can pay for the same room. Verify this before advertising the new system —
>   book a slot in the new system and confirm Acuity then refuses it.
> - Acuity remains a data processor while it runs, so it stays in the privacy policy (`12`).

## Establish this first

Before anything else, answer one question, because the whole plan depends on it:

> **When the Acuity subscription is cancelled, do the events it created on the three Google
> Calendars survive?**

Acuity syncs to Google Calendar as an external application. Depending on how it was connected,
those events may be owned by Acuity's connection and may be removed when the integration is
torn down. If they vanish, every future booking made through Acuity disappears from the
calendars — and since the calendars are our occupancy source of truth (D1), those rooms would
silently become bookable again while somebody has a receipt saying otherwise.

**Test it cheaply:** create a throwaway test booking in Acuity, confirm it appears on the
calendar, then disconnect *that one calendar's* sync and see whether the event survives.
Reconnect afterwards. Do not find this out by cancelling the subscription.

Whatever the answer, **export everything from Acuity before cancelling** — bookings, customers,
and the availability and pricing config, which is the only record of what the current rules
actually are.

## Phased cutover

### Phase A — Parallel, new system invisible

Deploy behind a flag. Acuity keeps taking all bookings. The new system reads the same calendars
and shows availability, but only to whoever knows the URL.

Verify against reality: does availability match what Acuity shows, for all three rooms, across
a fortnight? Any disagreement is a rules bug, and finding it here costs nothing.

### Phase B — New system live, Acuity read-only

Flip the facility pages to the new booking widget. In Acuity, block out all future availability
so no new bookings can be taken, but **do not cancel the subscription** — existing bookings
still need to be managed there.

Existing Acuity bookings continue to occupy the calendars, so the new system will not
double-book them. Their holders manage them through Acuity's links, which still work.

This phase lasts as long as the longest-dated existing booking. Check the export for how far
out that is — if someone has booked the Studio nine months ahead, that sets the timeline, and
those few bookings can be migrated by hand instead.

### Phase C — Acuity cancelled

Once the last Acuity booking has passed (or been migrated by hand), cancel the subscription.
Immediately afterwards, confirm all three calendars still hold the events they should.

Then remove the dead code: `AcuityBooking.astro`, the `bookingCategory` field in
`keystatic.config.ts`, and the Acuity references in `README.md`.

## Migrating a booking by hand

For the handful that need it, a script — `scripts/import-acuity-booking.mjs` — takes the
details from the Acuity export and creates a Firestore booking record linked to the calendar
event that already exists.

- `payments` records the Acuity payment as an external entry: `kind: 'charge'`,
  `squarePaymentId: null`, `reason: 'acuity-import'`. It is money that was taken, but not by us.
- **A migrated booking cannot be refunded automatically** — the money is in Acuity's
  processor, not our Square account. Mark it `refundable: false`; the cancel flow must detect
  this, refuse to promise a refund, and route the booker to the DRA instead. Getting this
  wrong means promising a refund the system cannot issue.
- Issue a magic link and email the holder to say booking management has moved.

## Content and copy

- `README.md` — replace the Acuity rows in the stack table and the "Room Booking" section.
- Facility pages — the booking widget replaces the iframe; check that the surrounding copy
  still reads correctly.
- Privacy policy (a Google Doc, per the redirect in `astro.config.mjs`) — needs updating for
  booking data: what is stored, where, for how long, and who it is shared with (Google, Square,
  Brevo). This is a genuine obligation, not boilerplate.
- Add a terms-of-hire page: cancellation policy, room rules, liability, damage. Link it from
  the booking form's consent checkbox. **The DRA must supply the wording.**

## Rollback

Through Phase B, rollback is: turn the flag off, reopen Acuity's availability. Acuity is still
subscribed, so this is a minutes-long operation. That is precisely why Phase B keeps paying for
Acuity rather than cancelling on day one — a month's subscription is cheap insurance.

After Phase C there is no rollback, only forward fixes. Do not enter Phase C during a busy
booking period or immediately before a holiday.

## Acceptance criteria

- [ ] Acuity's calendar-sync behaviour on disconnection is tested and documented before cancellation.
- [ ] A full Acuity export (bookings, customers, config) is stored somewhere durable.
- [ ] New-system availability matches Acuity's for all three rooms across a fortnight.
- [ ] Existing Acuity bookings cannot be double-booked by the new system.
- [ ] Migrated bookings are flagged non-refundable and the cancel flow honours it.
- [ ] The privacy policy covers booking data before the first real booking is taken.
- [ ] Terms of hire exist and are linked from the booking form.
- [ ] After Phase C, no Acuity code, config or documentation remains.
