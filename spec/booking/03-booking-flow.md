# 03 — Booking flow

## The page

`/facilities/{slug}` keeps its content and gains a real booking widget in place of the Acuity
iframe. The widget is progressive: room and date pickers work as plain links with query
params, so the slot list is server-rendered and usable without JavaScript. Card entry needs
JS — Square's SDK requires it — so the final step is the only hard JS dependency, and it says
so, with the phone number and email as the fallback.

Steps, all on one page, revealed in sequence:

1. **Date** — month view, days with no availability visibly disabled.
2. **Start time** — from `/api/booking/availability`.
3. **Duration** — the enumerated durations for that start, each showing its price.
4. **Your details** — name, email, phone (optional), organisation (optional), notes (optional).
5. **Pay** — Square Web Payments card field, total restated, terms checkbox.

## The double-booking guard

This is the part that has to be right. Two people can be on step 5 for the same slot at the
same time, and the gap between "slot looked free" and "money taken" is seconds to minutes.

`POST /api/booking/create` — body: `{ room, start, durationMins, customer, sourceId, verificationToken? }`

```
1  Validate shape. Reject unknown room, inactive room, non-grid start,
   duration outside min/max, missing consent.

2  Re-price server-side: pricePence = priceFor(room, start, end).
   The client's number is ignored entirely. If it disagreed, log it.

3  Check rules against *now*: minNoticeHours, maxAdvanceDays, opening hours.

4  ── Firestore transaction ──────────────────────────────────────────
     read  bookings where room == R and localDate == D
                     and status in ['held', 'confirmed']
     read  holds    where room == R and localDate == D
                     and expiresAt > now
     if any overlaps [start - buffer, end + buffer]  → abort, 409
     write holds/{holdId}  { room, localDate, start, end,
                             expiresAt: now + 5min, bookingRef }
   ─────────────────────────────────────────────────────────────────
   Firestore aborts and retries the transaction on contention, so exactly
   one of two racing requests can create an overlapping hold.

5  Re-check Google Calendar freebusy for [start - buffer, end + buffer].
   Catches a committee block created in the last 60 seconds that the
   availability cache hadn't seen. Busy → delete hold, 409.

6  Charge Square. idempotencyKey = holdId.  (see 04-payments-and-refunds.md)
   Declined → delete hold, return Square's message, 402. Nothing persisted.

7  Write bookings/{bookingRef}: status 'confirmed', payments ledger entry,
   paidPence = pricePence, history ['created'].

8  Insert the Google Calendar event. Store calendarEventId on the booking.
   Fails → booking stays 'confirmed' with calendarEventId null. Alert the
   owner, let reconciliation retry. The booker is paid up and must not be
   told anything is wrong; the room is theirs.

9  Delete the hold. Issue a magic-link token. Send the confirmation email.
   Invalidate the availability cache for room + date.

10 Respond { bookingRef, manageUrl }. Client redirects to /bookings/{ref}
   and stores { bookingRef, token } in localStorage.
```

### Ordering rationale

The hold is taken **before** the charge so that the failure mode is "a slot is briefly
unbookable by anyone" rather than "two people are charged for one room". Money is the hard
thing to reverse; a five-minute phantom hold is not.

The calendar insert comes **after** the charge because a calendar event we can't collect money
for is worse than a payment whose calendar event lands a beat late — the latter is
recoverable by reconciliation, the former silently gives away a room.

Step 5 exists because the calendar is the source of truth (D1) and the transaction in step 4
can only see Firestore. Skipping it would let a committee block be double-booked.

### What can still go wrong

| Failure | Result | Recovery |
|---|---|---|
| Crash between 6 and 7 | Charged, no booking record | Square webhook (`04`) finds the orphan payment by idempotency key and either completes the booking or refunds. Alert either way |
| Crash between 7 and 8 | Booking exists, no calendar event | Reconciliation recreates it within the hour |
| Crash between 8 and 9 | All good, no email | Hold expires harmlessly. Booker can retrieve their link via `/bookings/find` |
| Square times out, outcome unknown | Unknown | Never retry a charge on timeout. Query Square by idempotency key and act on what it says |

## Validation

Server-side, always. Client-side hints are a convenience only.

- `name` 2–100 chars. `email` RFC-ish and lower-cased. `phone` optional, UK-ish, 20 chars max.
- `notes` 500 chars max, plain text, HTML-escaped everywhere it is rendered — it reaches the
  calendar description and the owner's inbox.
- Reject a `start` not on the `slotGranularityMins` grid.
- Rate limit `create` per IP and per email: 5 attempts in 10 minutes.
- Honeypot field plus a minimum time-to-submit to blunt naive bots. No CAPTCHA in v1 — card
  payment is itself a strong spam filter.

## Confirmation page

`/bookings/{bookingRef}` — reachable with a valid token, from local storage, or straight after
booking. Shows room, date, time, duration, price paid, reference, and buttons to amend or
cancel. Offers an `.ics` download and lists what to expect on arrival (`capacityNote`).

## Acceptance criteria

- [ ] Two concurrent `create` calls for the same slot: one 201, one 409, exactly one Square charge.
- [ ] A calendar block created between availability load and submit produces a 409 and no charge.
- [ ] A declined card leaves no booking, no hold and no calendar event.
- [ ] A tampered client-side price is ignored; the server's price is charged and the mismatch logged.
- [ ] A forced failure of the calendar insert still yields a confirmed, paid booking and an owner alert.
- [ ] The slot list is browsable and readable with JavaScript disabled.
- [ ] Submitting the same form twice in quick succession charges once.
- [ ] Holds older than 5 minutes stop blocking availability.
