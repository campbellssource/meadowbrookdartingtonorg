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
  slotGranularityMins: integer   // grid the start times sit on. Default 30
  minDurationMins:     integer   // Default 60
  maxDurationMins:     integer   // Default 480
  bufferMins:          integer   // gap forced before and after every booking. Default 0
  minNoticeHours:      integer   // can't book something starting sooner than this. Default 24
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

Three independent Snooker data points at different durations all agree, so £7.50/hour flat,
billed in 30-minute increments, is solid.

**Confirm the Studio before launch.** There is only one data point, and it gives the Studio —
75 m², vaulted ceiling, capacity 100 — the same hourly rate as the Lounge. That may well be
deliberate, but it may equally be a promotional rate, an off-peak booking, or simply the one
example that happened to be visible. Do not launch on a single observation; check it against
the Acuity config export (`09`).

Bookings observed running from 09:00 to 22:00, so opening hours reach at least that far.

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
   sooner than `minNoticeHours` from now; or start later than `maxAdvanceDays` from today.
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

- [ ] A closed weekday returns `open: false` and no slots.
- [ ] A calendar event created by hand disappears from availability within 60 seconds.
- [ ] `bufferMins: 15` leaves no bookable start within 15 minutes either side of an existing booking.
- [ ] `minNoticeHours: 24` makes tomorrow morning unbookable this evening.
- [ ] A Saturday booking straddling a peak boundary is priced per increment, not per booking.
- [ ] Slot generation on both 2027 BST transition days produces valid, non-duplicated instants.
- [ ] An active hold removes the slot from availability for everyone else.
- [ ] Setting `active: false` on a room removes it from booking without breaking its facility page.
