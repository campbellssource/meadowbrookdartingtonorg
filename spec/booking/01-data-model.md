# 01 — Data model

## The split

Two stores, one rule: **the calendar decides whether a room is free; Firestore explains why.**

```
Google Calendar (per room)              Firestore (project: meadowbrook-booking)
────────────────────────────            ────────────────────────────────────────
Every event = room unavailable          bookings/{bookingRef}
  ├ committee block  (manual)             who, what, how much, which payment
  ├ Acuity legacy    (until cutover)      calendarEventId ──┐
  └ our booking      (has extProps) ◄─────────────────────  ┘
                                        holds/{holdId}       short-lived slot reservation
                                        tokens/{jti}         magic-link tokens
                                        counters/{name}      bookingRef sequence
```

If the two ever disagree, the calendar wins for availability and Firestore is reconciled (see
"Reconciliation" below). We never compute availability from Firestore alone — that would let a
manual committee block get double-booked, which is the exact failure the current setup avoids.

## Firestore

Native mode, region `europe-west2`. All timestamps stored as Firestore `Timestamp` (UTC).

### `bookings/{bookingRef}`

`bookingRef` is the document ID and the human-facing reference, format `MB-7K2QX4` — six
Crockford base32 characters from a CSPRNG, ambiguity-prone letters excluded. Not sequential:
a guessable reference plus an email address should not be enough to find a booking.

| Field | Type | Notes |
|---|---|---|
| `room` | string | Facility slug: `snooker-room` \| `large-room` \| `small-room` |
| `status` | string | `held` \| `confirmed` \| `cancelled` \| `orphaned` |
| `start` | Timestamp | UTC instant |
| `end` | Timestamp | UTC instant |
| `localDate` | string | `YYYY-MM-DD` in `Europe/London`. Query key — see below |
| `durationMins` | number | Denormalised for reporting |
| `pricePence` | number | What is currently owed for this booking |
| `paidPence` | number | Sum of captured payments minus refunds. Equals `pricePence` when settled |
| `customer` | map | `{ name, email, phone?, organisation?, notes? }` |
| `calendarEventId` | string \| null | The event we created on the room calendar |
| `payments` | array\<map\> | Append-only ledger, see below |
| `seriesId` | string \| null | Reserved for recurring bookings. Always `null` in v1 |
| `createdAt` | Timestamp | |
| `updatedAt` | Timestamp | |
| `history` | array\<map\> | Append-only: `{ at, action, from?, to?, actor }` where `actor` is `booker` \| `admin` \| `system` |

**Why `localDate`.** Availability and the overlap check both work a day at a time, and
Firestore has no range-plus-equality index trick that beats a straight equality filter here.
Storing the `Europe/London` calendar date alongside the UTC instants gives a cheap, exact
`where('room','==',r).where('localDate','==',d)` query, which is what the write transaction
reads. Deriving it from `start` at query time would be wrong across BST boundaries.

### The `payments` ledger

Append-only. Never mutate an entry; correct by appending.

```
{ at: Timestamp,
  kind: 'charge' | 'refund',
  amountPence: number,          // always positive; `kind` carries the sign
  squarePaymentId: string,
  squareRefundId: string | null,
  idempotencyKey: string,       // what we sent Square; see 04
  status: 'completed' | 'pending' | 'failed',
  reason: string | null }       // 'initial' | 'amend-up' | 'amend-down' | 'cancel'
```

`paidPence` is the derived sum and is stored so reporting doesn't have to fold every ledger.
Any code that appends to `payments` recomputes `paidPence` in the same write.

### `holds/{holdId}`

A hold is a short-lived claim on a slot, taken inside a transaction *before* we talk to Square,
so two people entering card details for the same slot can't both succeed. See `03-booking-flow.md`.

| Field | Type | Notes |
|---|---|---|
| `room`, `localDate`, `start`, `end` | | Same shape as a booking — the overlap query reads holds and bookings together |
| `expiresAt` | Timestamp | `now + 5 min`. A hold past its expiry is ignored by the overlap check |
| `bookingRef` | string | The reference this hold will become |

Expired holds are ignored logically and swept by a TTL policy on `expiresAt`, so no cron is
needed to keep the collection tidy.

### `tokens/{jti}`

Magic-link tokens are signed and self-contained, so this collection exists purely to make them
**revocable** and to record use. See `05-manage-booking.md`.

| Field | Type | Notes |
|---|---|---|
| `bookingRef` | string | |
| `email` | string | Lower-cased. Must match the booking's customer email |
| `issuedAt`, `expiresAt` | Timestamp | |
| `revokedAt` | Timestamp \| null | Set on cancellation and on re-issue |
| `lastUsedAt` | Timestamp \| null | |
| `useCount` | number | |

### `counters/{name}`

Reserved. Not used in v1 — booking references are random, not sequential.

## Calendar event shape

Modelled deliberately closely on what Acuity produces today, because the committee already
reads these events at a glance and there is no reason to make them learn a new layout. Acuity's
current output, for reference:

```
summary:  B Few: Snooker room. 2h (Snooker room)
location: Meadowbrook, Shinners Bridge Dartington, TQ9 6JD
description:
    August 2, 2026 12:00 BST
    Calendar: Snooker room
    Name: B Few
    Phone: +447443960044
    Email: brianfew5@gmail.com
    Price: £15.00
    Paid Online: £15.00
    … Location / Subscribe to updates / T&Cs blocks …
    Change Appointment: https://secure.acuityscheduling.com/appointments/view/1746135184
    (created by Acuity Scheduling)
    AcuityID=1746135184
```

### What we produce

```
summary:  Jane Smith: Studio. 2h

location: Meadowbrook, Shinners Bridge Dartington, TQ9 6JD

description:
    Saturday 5 September 2026, 14:00 BST
    Calendar: Studio - Large room
    Name: Jane Smith
    Phone: +447700900000
    Email: jane@example.com
    Price: £20.00
    Paid Online: £20.00

    Location
    ============
    Meadowbrook, Shinners Bridge Dartington, TQ9 6JD


    Subscribe to updates
    ============
    Add me to the email list for occasional updates from the charity that runs Meadowbrook: yes


    T&Cs Studio
    ============
    How do you intend to use the room?: Yoga class

    Tick to agree to the room hire terms and conditions? https://meadowbrookdartington.org/room-hire-terms: yes


    Change or cancel this booking:
    https://meadowbrookdartington.org/bookings/MB-7K2QX4

    Booked on the Meadowbrook website. Please don't edit this event by hand — use the
    link above, so the booker is told and any refund is made.
    Ref MB-7K2QX4

extendedProperties.private:
    { mbBookingRef: 'MB-7K2QX4', mbSource: 'meadowbrook-site', mbVersion: '1' }
```

### Deliberate differences from Acuity

| Acuity | Ours | Why |
|---|---|---|
| `… 2h (Snooker room)` | `… 2h` | The trailing calendar name is redundant — you can already see which calendar you're looking at. Drops noise from the month view, where the title is truncated anyway |
| `August 2, 2026 12:00 BST` | `Saturday 5 September 2026, 14:00 BST` | Weekday spelled out. It is what people actually check |
| `AcuityID=1746135184` in the body | `extendedProperties.private.mbBookingRef` | A machine-readable marker Calendar can filter on server-side via `privateExtendedProperty`, rather than a string to parse out of prose. `Ref MB-7K2QX4` stays in the body for humans |
| "Please use Acuity Scheduling to cancel" | A link straight to the booking | The committee can act on it, not just read it |

Everything else — the `Name / Phone / Email / Price / Paid Online` header block, the
`============` section rules, the Location and Subscribe and T&Cs blocks — is kept as-is.

### Duration formatting

Match Acuity exactly, because it appears in the summary and reads well: `1h`, `2h`,
`2h 30mins`, `3h`, `4h`. Note the irregular `30mins` — not `30m`, not `30 mins`. One helper,
`formatDuration(mins)`, used everywhere.

### The per-room intake question

Acuity asks **"How do you intend to use the room?"** on the Studio and the Lounge, but not on
the Snooker Room. That is a per-room custom field, so the Keystatic config carries a
`intakeQuestions` array per room rather than the form hard-coding one question. Answers are
stored in `customer.answers` and rendered into the T&Cs block of the description.

### The newsletter opt-in

Already part of today's booking form ("Add me to the email list for occasional updates from the
charity that runs Meadowbrook"), and it appears in the description whether or not it was
ticked. Keep it: an unticked checkbox on the booking form, written to the existing Brevo list
through the existing `/api/subscribe` endpoint. It is separate from the transactional booking
emails (`06`) and must stay that way.

### Machine-readable marker

`extendedProperties.private` is how reconciliation tells *our* events apart from the three
other kinds on these calendars, all of which are real and currently in use:

- **Committee blocks** — e.g. "Pool commitee" on the Lounge.
- **Regular hirers entered by hand** — e.g. "BSAC" (Totnes Sub-Aqua Club) and "Liam" and
  "Rollen", all recurring events created directly by a person. These are the recurring hires
  deferred in `00`, and they confirm the design: they occupy the calendar, so the booking
  system will never double-book them, and nothing about them has to change.
- **Acuity leftovers** — identifiable by `AcuityID=` in the description until cutover completes.

The "please don't edit this event by hand" line matters. A committee member dragging one of our
events to a new time would move the room block without refunding, re-pricing or telling the
booker. Reconciliation detects it; the note tries to prevent it.

## Reconciliation

A scheduled job (`/api/booking/cron/reconcile`, hourly — see `08-infrastructure.md`) walks the
next 90 days of each room calendar and compares it with Firestore:

| Situation | Action |
|---|---|
| Confirmed booking, no matching calendar event | Recreate the event from the booking. Log a warning |
| Our event (`mbBookingRef` set), no matching booking | Leave the event alone, email the owner. Never auto-delete something a person might be relying on |
| Times disagree | Calendar wins for occupancy; flag the booking `needsReview` and email the owner with both times. Do not auto-refund |
| Booking stuck `held` past `expiresAt` with no payment | Mark `orphaned`, release |
| Booking `confirmed` but `calendarEventId` null | The charge succeeded and the event insert failed. Retry the insert; alert on repeated failure |

Reconciliation only ever *adds* safety. It must never move money and never delete a booker's
event without a human deciding.

## Acceptance criteria

- [ ] A booking written by the site appears on the correct room calendar within one request cycle.
- [ ] A manually created calendar event makes that slot unbookable on the site immediately (subject only to the availability cache TTL).
- [ ] Two simultaneous booking attempts for the same slot result in exactly one confirmed booking and exactly one Square charge.
- [ ] `paidPence` always equals the signed sum of the `payments` ledger.
- [ ] Deleting our calendar event by hand causes reconciliation to recreate it and log a warning, not to lose the booking.
- [ ] No booking document is ever hard-deleted; cancellation sets `status` and appends history.
