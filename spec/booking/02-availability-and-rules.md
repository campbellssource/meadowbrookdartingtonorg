# 02 — Availability and booking rules

## Where rules live

Split by how often they change.

| Changes | Lives in | Latency |
|---|---|---|
| Rooms, prices, opening hours, durations, notice periods | **Keystatic** (git) | Merge → deploy, a few minutes |
| "The Studio is unavailable on 12 October" | **Google Calendar** | Instant |

Prices and opening hours change perhaps twice a year; a deploy is fine and git history gives
the committee a free audit trail of who changed a price and when. One-off blocking is the
thing that needs to be instant, and it already is.

No admin UI for rules is built. That's deliberate: an admin UI here would be a second source of
truth for something the CMS already models well.

## Keystatic schema

Extend the existing `facilities` collection's `bookable` discriminant in `keystatic.config.ts`.
`bookingCategory` (the Acuity string) is replaced by this block at cutover, not before.

```
booking: {
  calendarId:        string      // the room's Google Calendar ID
  shortName:         string      // "Studio" — used in calendar event summaries and emails
  hourlyRatePence:   integer     // base rate
  peak: [                        // optional, ordered; first match wins
    { days: ['sat','sun'], from: '09:00', to: '22:00', hourlyRatePence: integer }
  ]
  openingHours: [                // per weekday; omit a day to close it entirely
    { day: 'mon', from: '09:00', to: '22:00' }
  ]
  slotGranularityMins: integer   // grid the start times sit on. 15 everywhere
  minDurationMins:     integer   // 60 everywhere
  durationIncrementMins: integer // steps above the minimum. 30 everywhere
  maxDurationMins:     integer   // 900 (08:00-23:00); real cap is closing time
  bufferMins:          integer   // gap forced before and after every booking. 0 snooker, 30 studio/lounge
  minNoticeHours:      integer   // 0 everywhere; the quarter-hour rule is the real floor
  maxAdvanceDays:      integer   // can't book further out than this. Default 180
  capacityNote:        string    // free text shown on the booking form
  intakeQuestions: [             // per-room custom fields; empty for the Snooker Room
    { key: 'use', label: 'How do you intend to use the room?', required: true }
  ]
  active:              boolean   // false hides the room from booking without deleting config
}
```

All times are `HH:MM` in `Europe/London`. All money is integer pence — never floats, anywhere.

## Rates observed in live bookings

Derived from Acuity-created calendar events, so these are what is actually being charged today
rather than what anyone remembers the price being:

| Room | Evidence | Implied rate |
|---|---|---|
| Snooker | 1h = £7.50, 2h = £15.00, 2h 30m = £18.75 | **£7.50/hour** |
| Lounge (Small room) | 3h = £30.00 | **£10.00/hour** |
| Studio (Large room) | 4h = £40.00 | **£10.00/hour** |

**All three confirmed by the DRA, 31 Aug 2026.** Snooker £7.50/hour; Studio and Lounge
£10.00/hour each. The reading above matched in every case, including the Studio, which rested
on a single observation and which the DRA has now confirmed is deliberately the same rate as
the Lounge. Billed in 30-minute increments. No peak or weekend rate exists — `peak` stays
empty for all three rooms in v1.

### Per-room starting config

| | Snooker | Studio | Lounge |
|---|---|---|---|
| `hourlyRatePence` | `750` | `1000` | `1000` |
| `minNoticeHours` | **`0`** | `24` (to confirm) | `24` (to confirm) |
| `intakeQuestions` | none | use of room | use of room |

**Snooker's `minNoticeHours` is 0 on purpose** — and so, the DRA has since confirmed, is every
other room's. All three are bookable right up to the next quarter-hour. Snooker's empty forward
calendar was never missing data; the room is booked last-minute as a matter of course. A
24-hour default would have quietly destroyed that pattern while appearing to work perfectly:
availability would render, bookings would succeed, and only the walk-up trade would vanish.

## The confirmed ruleset

Everything below is DRA-confirmed (31 Aug 2026) and replaces the earlier defaults.

### Identical across all three rooms

| Rule | Value |
|---|---|
| Opening hours | **08:00–23:00, every day.** No closed days, no weekday variation |
| Rate | Flat. No peak, off-peak or weekend rate — `peak` is empty everywhere |
| VAT | **None.** Prices are stated VAT-free, not VAT-inclusive — see below |
| Maximum advance | **90 days** |
| Minimum duration | **60 minutes** |
| Duration increments | **30 minutes** — 1h, 1h30, 2h, 2h30 … |
| Maximum duration | **A single day.** A booking may not span midnight |
| Start times | **:00, :15, :30, :45 only** — `slotGranularityMins: 15` |
| Minimum notice | **None**, subject to the quarter-hour rule below |
| Cancellation | Full refund up to 1 hour before the start (`00`, D4) |

### Per room

| | Snooker | Studio | Lounge |
|---|---|---|---|
| `hourlyRatePence` | `750` | `1000` | `1000` |
| `bufferMins` | **`0`** | **`30`** | **`30`** |
| `maxAdvanceDays` | `90` | `90` | `90` |
| `intakeQuestions` | none | use of room | use of room |

**Buffer semantics — settled 31 Aug 2026.** Per-room, as built: 30 minutes either side of a
Studio booking and 30 either side of a Lounge booking, each affecting only its own room. Not a
cross-room buffer. Snooker has none, deliberately — the DRA wants snooker sessions back to
back, because players meeting in the doorway is a feature of the room rather than a scheduling
problem.

⚠️ **This is a change from current behaviour, not a replication of it.** A Studio booking
already on the calendar runs 17:00–19:00 with the next starting 19:15 — a 15-minute gap, which
a 30-minute buffer would forbid. So Acuity is not enforcing 30 minutes today. The new rule is
stricter, which is a legitimate choice, but it has two consequences worth stating:

- **Studio and Lounge availability will legitimately differ from Acuity's**, and Phase 1's
  acceptance check has been adjusted accordingly (see `IMPLEMENTATION-PLAN.md`). Treating any
  difference as a bug would send us hunting a fault that isn't there.
- **It will refuse some bookings Acuity would have accepted.** Worth a moment's thought about
  whether 30 minutes is right, given hirers are demonstrably booking 15 minutes apart today.

Based on one observed pair, not a survey — a fuller count of historical gaps needs a working
`gcloud` session and is worth running before Phase 1 sets the number in stone.

### Start times: the quarter-hour rule

Minimum notice is zero, but a booking cannot start in the quarter-hour you are already
standing in. Concretely:

> **The earliest bookable start is the smallest quarter-hour boundary strictly after `now`.**

At 14:07 the earliest start is 14:15. At 14:00:20 it is 14:15, not 14:00 — the 14:00 block has
begun. Defining it as *strictly after* rather than *at or after* costs at most fifteen minutes
and removes a whole class of clock-skew bug: the browser's clock, the server's clock and
Google's clock disagree by seconds, and "at or after" turns those seconds into a slot that
renders as bookable but fails at payment.

Maximum duration is bounded by closing time, not by a fixed number: a booking must end by
23:00 on the day it starts. `maxDurationMins: 900` (08:00→23:00) is therefore a ceiling that
only the very first slot of the day can reach.

### How the rules interact — the cases to test

The rules are simple individually and less so together:

- **Buffer plus 15-minute grid.** A Studio booking 14:00–15:00 blocks 13:30–15:30. The next
  bookable start is 15:30, not 15:00 and not 15:15.
- **Zero notice plus a 1-hour cancellation window.** Any booking made less than an hour before
  it starts is non-refundable the moment it is paid for. With zero minimum notice this is now
  reachable in *every* room, not just Snooker, and the earliest possible start is 15 minutes
  away. Checkout must say so before charging (`04`, `10`).
- **Duration increments versus start grid.** Starts move in 15s, durations in 30s. 14:15 + 1h30
  = 15:45 is valid. A 45-minute booking is not, at any start.
- **Buffer at the edges of the day.** A booking ending at 23:00 needs no buffer after it; one
  starting at 08:00 needs none before. Buffer is clipped at opening hours, not treated as a
  reason to make the first and last slots unbookable.

## Computing availability

`GET /api/booking/availability?room={slug}&from={YYYY-MM-DD}&to={YYYY-MM-DD}`

Server-side, per day in the range:

1. **Start from opening hours** for that weekday. Closed day → no slots, stop.
2. **Fetch busy blocks** from the room calendar via `freebusy.query` for the day, in
   `Europe/London`. This returns every event regardless of who made it, which is exactly the
   behaviour we want: committee blocks, Acuity leftovers and our own bookings all count.
3. **Fetch same-day holds** from Firestore (`holds` where `room`, `localDate`, `expiresAt > now`)
   and merge them into the busy set. A hold is invisible on the calendar but must block others.
4. **Inflate every busy block by `bufferMins`** on both sides.
5. **Generate candidate starts** on the `slotGranularityMins` grid within opening hours.
6. **Drop candidates** that: overlap an inflated busy block for the minimum duration; start
   at or before the current quarter-hour boundary (the rule above); or start later than
   `maxAdvanceDays` from today.
7. For each surviving start, compute the **maximum bookable duration** — the run of free time
   from that start, capped at `maxDurationMins` and at closing time.

Response:

```
{ room: 'large-room',
  timeZone: 'Europe/London',
  days: [ { date: '2026-09-05',
            open: true,
            slots: [ { start: '2026-09-05T09:00:00+01:00',
                       maxDurationMins: 240,
                       durations: [ { mins: 60,  pricePence: 2400 },
                                    { mins: 90,  pricePence: 3600 },
                                    { mins: 120, pricePence: 4800 } ] } ] } ] }
```

Durations are enumerated with prices so the client never does money arithmetic. The client
displays what the server says; the server re-prices on submit and does not trust the client.

## Pricing

`priceFor(room, start, end)` in `src/lib/booking-pricing.ts`. Pure, no I/O, unit-testable.

- Walk the booking in `slotGranularityMins` increments.
- Each increment is charged at the first matching `peak` rule for its start, else `hourlyRatePence`.
- Sum, rounding only once at the end, to the nearest penny.

Charging per increment rather than per booking means a 17:00–19:00 Saturday booking that
straddles a peak boundary is priced correctly instead of being all-peak or all-off-peak.

## Time zones and DST

Everything the booker sees is `Europe/London`. Everything stored is UTC. The two BST
transition days are where naive implementations break.

- Convert with a real IANA-aware library, never by adding a fixed offset. `Temporal` where
  available, otherwise `Intl.DateTimeFormat` with `timeZone: 'Europe/London'`.
- On the March spring-forward day, 01:00–02:00 local does not exist; slot generation must skip
  it rather than emit an invalid instant.
- On the October fall-back day, 01:00–02:00 local happens twice; a booking there is 2 real
  hours. Rooms are shut at that hour so this is theoretical, but the slot generator must not
  crash or double-emit.
- `localDate` is always derived from the *start* instant in `Europe/London`.

Write unit tests for both transition dates. They are cheap and they are the bugs that
otherwise surface at 2am on a Sunday in October.

## Caching

Availability is read far more often than bookings are made, and the Calendar API has quota.

- Cache the computed availability per `room + date` in memory for **60 seconds**.
- **Invalidate immediately** on any write to that room and date (booking, amend, cancel).
- Never cache holds — they're already read fresh inside the 60s window and a stale hold is
  worse than a redundant read.
- Cloud Run scales to more than one instance, so the cache is per-instance and best-effort.
  It is an optimisation, never a correctness mechanism. The transaction in `03` is what
  actually prevents double-booking.

## Acceptance criteria

- [ ] Every day is open 08:00–23:00; no day returns `open: false`.
- [ ] A calendar event created by hand disappears from availability within 60 seconds.
- [ ] Every offered start falls on :00, :15, :30 or :45.
- [ ] Every offered duration is 60 minutes or more, in 30-minute steps. No 45-minute option exists.
- [ ] At 14:07 the earliest start offered is 14:15. At 14:00:20 it is still 14:15.
- [ ] A Studio booking 14:00–15:00 makes 15:30 the next bookable start, not 15:00 or 15:15.
- [ ] The same booking in the Snooker Room makes 15:00 bookable — `bufferMins: 0`.
- [ ] No offered slot can run past 23:00, and no booking spans midnight.
- [ ] The 08:00 start and a slot ending at 23:00 are both bookable — buffer is clipped, not applied, at the edges of the day.
- [ ] Slot generation on both 2027 BST transition days produces valid, non-duplicated instants.
- [ ] An active hold removes the slot from availability for everyone else.
- [ ] Setting `active: false` on a room removes it from booking without breaking its facility page.

## VAT

The DRA is not charging VAT (question 14, answered 31 Aug 2026) but expects it may need to
later. One thing to record now, because it is cheap today and contentious later:

**Today's prices are VAT-free, not VAT-inclusive at 0%.** If the DRA registers, the question
"was £10.00 the gross or the net price?" decides whether hirers see a price rise or the DRA
takes a 20% cut in income. Writing it down now means that is a decision rather than an
argument.

Implementation: `priceFor()` stays the single place a price is computed, so VAT becomes an
additive step there rather than a change spread across the booking form, the emails and the
reporting page. No VAT fields in the data model yet — `paymentPence` is what was charged, and
that stays true either way.
