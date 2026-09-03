# 13 — Door access, and what already reads these calendars

Found on 31 Aug 2026 while checking a claim in `12` about calendar data retention. The three
room calendars are **not** only read by this project. A separate live system in the
`calendartopasscode` GCP project watches them and issues smart-lock passcodes.

This changes what "write a calendar event" means. Under D1 the calendar is the booking system's
source of truth for occupancy; it is also, already, the trigger for physical access to the
building. Creating an event is not an inert record — **it unlocks a door.**

Nothing in `00`–`12` accounted for this.

## What exists

Project `calendartopasscode`, region `us-central1`. Cloud Functions, all `ACTIVE`:

| Function | Trigger | Does |
|---|---|---|
| `calendarWebhook` | Google Calendar push | On event create/update/delete: creates, moves or revokes a TTLock passcode, and syncs a Google Contact |
| `initializeWebhook` / `renewWebhooks` | Scheduler, every 5 days | Registers and renews the calendar watch channels |
| `cleanupExpiredCodes` | Scheduler, hourly | Removes passcodes for finished bookings |
| `cleanupExpiredContacts` | Scheduler, daily 03:30 | Deletes synced Google Contacts **7 days** after a booking ends |
| `refreshTTLockToken` | Scheduler, 1st of every other month | Keeps the TTLock OAuth token alive |
| `checkBatteryLevels` | Scheduler, daily 07:00 | Lock battery monitoring |

Two locks: `3670800` ("Entrance Lock") and `3536180` ("Upstairs Lock"). A booking gets one
4-digit passcode provisioned on both.

## What this means for the booking system

### 1. Our bookings will issue door codes automatically — and that is the good news

When Phase 2 writes a confirmed booking to a room calendar, `calendarWebhook` fires and
provisions a passcode. The DRA gets keyless access for new bookings without this project
building anything. That is a genuine windfall and it is the strongest argument yet for D1.

**But it is only a windfall if the event we write is one that system can parse.** Acuity's
events carry a rigid description format —
`<date> | Calendar: <room> | Name: <name> | Phone: <phone> | Email: … | Price: …`. Before
Phase 2 writes its first event, read the `calendarWebhook` source and match whatever it
actually relies on. Getting this wrong fails in the worst possible direction: the booking
succeeds, the payment clears, the confirmation email goes out, and the hirer stands outside a
locked building.

**Test in Phase 2, not at launch.** A dev-calendar booking (`11`) will not exercise this, since
the watch is on the live calendars — so this needs one deliberate test against a real calendar,
in a slot nobody wants, before the system takes real money.

### 2. All three rooms are wired to locks — question 23, answered from source

Read out of `config/lockMappings.js` on 31 Aug 2026, so this is the configuration
itself rather than an inference:

| Room | Locks |
|---|---|
| Lounge | Entrance (`3670800`), Upstairs (`3536180`) |
| Studio | Entrance, Upstairs |
| **Snooker** | Entrance, Upstairs, **Snooker Room Lock (`25730366`)** |

**This corrects an earlier reading in this file.** The single `GOOGLE_CALENDAR_ID`
environment variable is a fallback, not the configuration: watch channels are registered per
calendar from the mappings above, and the webhook resolves which calendar fired from the
channel ID. All three rooms provision door codes. The Snooker Room has a third lock the other
two do not.

### 3. The door code is the last four digits of the booker's phone number — superseded 3 Sep 2026

**Superseded.** Allocation moved into the booking system; see "Door codes are allocated here"
below. The description of the phone-derived rule is kept because the door system still
behaves this way until it is changed to read the `Pass Code:` line.


`utils/phoneExtractor.js`, `extractPasscodeFromDescription`. The description is matched against
`Phone:\s*(\+?\d{10,})` and the passcode is `digits.slice(-4)`.

Three consequences the booking system has to live with:

- **The phone number must be contiguous digits.** `07725 972868` fails `\d{10,}` at five
  digits, so the booking gets no door code at all — and nothing about the booking looks wrong.
  `event-format.ts` strips separators for exactly this reason.
- **A hirer's door code is derived from their own phone number.** That is a sensible design
  (it is memorable and needs no separate communication), but it is a fact about personal data
  that the privacy policy does not currently mention (`12`).
- **Codes can collide**, which is the failure already visible in the logs: two people whose
  numbers end in the same four digits, or a collision with a manually-set code.

### 4. Nothing scrubs the calendar event descriptions — a correction

`services/calendarService.js` never patches or updates an event; the system is **read-only** on
the calendars. `cleanupExpiredContacts` deletes **Google Contacts** records via the People API
seven days after a booking ends. It does not touch the calendar.

This corrects a claim made earlier in this file. The evidence for "scrubbing works on the
Lounge" was a single Lounge event whose description was only `Phone: +440000002216` — no date,
no `Name:`, no `Price:`. That is much better explained as a **hand-made event created to grant
someone a door code** (last four digits, `2216`) than as a scrubbed Acuity booking. Reading the
source settles it: no code path writes to a calendar event.

So the position is:

| | Status |
|---|---|
| Google Contacts created per booking | Deleted after 7 days ✅ |
| Calendar event descriptions (name, phone, email, price) | **Never removed, on any calendar** |

Both things the DRA said are true — there *is* a cleanup job, and it does work — but it cleans
Contacts, not calendars. Names and mobile numbers on the room calendars go back as far as the
calendars do.

### 5. A calendar purge still has to be built by somebody

Since nothing currently rewrites calendar events, the retention promise in `12` has no
implementation anywhere. Two options, and the choice is the DRA's:

- **Extend `calendartopasscode`.** It already holds calendar credentials and knows the Acuity
  format — but it is deliberately read-only on calendars today, and giving it write access to
  the thing it watches is a meaningful change to a system that currently cannot damage them.
- **Build it in the booking system.** Write access is needed there anyway.

Either way it is one job, not two, and it must only ever rewrite `summary` and `description` —
never delete. Question 21, reinstated.

### 5. Our 90-day purge must not break it

Whichever system does the purge, it rewrites old calendar events. By 90 days every passcode is
long revoked and every contact long deleted, so there is no live conflict — but the purge must
still only rewrite `summary` and `description` and **never delete an event**, or it will look
like a cancellation to a system that reacts to cancellations.

### 6. Two systems now write contact data from one event

`calendarWebhook` syncs a Google Contact per booking and deletes it after 7 days. The booking
system will hold its own record in Firestore for far longer (`12`). Both are downstream of the
same calendar event. The privacy policy needs to describe both, and a deletion request has to
be honoured in both.

## Door codes are allocated here — 3 Sep 2026

The phone-derived rule failed in production three ways the door system could not see coming:
TTLock rejects "too simple" codes (`-2032`: 5555, 0123, 4321 were all refused), refuses to add a
code value that already exists on a lock even for a booking at a different time (`-3007`), and a
phone fragment can equal a permanent staff code. So the booking system now allocates the code
and writes it onto the event. The door system was changed separately the same day
(`ttlock-calendar-integration`, `parsePassCodeLine`): it reads the line and falls back to the
phone number when the line is absent.

### The rule

- Default: the last four digits of the booker's phone number, if the lock would accept them and
  nothing live is using them.
- Otherwise: a random **five**-digit code. Five so it can never equal a phone-derived code, and
  so it reads as "a door code" rather than a fragment of someone's number. TTLock takes 4–9.
- "Too simple" is a conservative superset of TTLock's unpublished rule: any run of four or more
  adjacent digits that is all one digit, or strictly consecutive by one in either direction,
  with 9→0 and 0→9 counting as consecutive. Confirmed rejections and acceptances from production
  are encoded as unit tests in `test/booking-door-code.test.ts`.
- A code is a **string**, everywhere. `0044` is a code; `44` is not the same code. Nothing
  stores, formats or logs it as a number.

### Where it lives

- `bookings/{ref}.doorCode` — `{ code, source: 'phone' | 'generated', allocatedAt }`.
  Allocated inside the same transaction that confirms the booking, so a confirmed booking always
  has one. Idempotent: amending or rescheduling never changes it.
- `doorCodes/{code}` — the reservation: which booking holds the code, and `expiresAt`, the
  release instant of **end + 24 hours**. Every booking uses the Entrance lock, so reservations
  are global across rooms. Cancelling does not release early — the code may still be on the
  lock until the door system's hourly sweep removes it. A TTL policy on `expiresAt` tidies the
  record; the allocator treats a record past it as free in the meantime.
- Bookings made before this change carry no `doorCode`. They are shown the phone fragment the
  door system derived (`doorCodeOf`), and are only allocated a code when something is about to
  rewrite their event anyway — an amendment, or the reconcile sweep restoring a deleted event.

### The event

One more line in the description, directly after `Phone:`, exactly:

```
Pass Code: 48213
```

Label, colon, one space, digits, nothing else. Four or five digits. The `Phone:` line is left
exactly as it was — the door system still reads it for call screening. `sanitiseForCalendar`
refuses a booker's name that contains `Pass Code:`, for the same reason it refuses `Phone:`.

If a booking's code and its event ever disagree — a hand edit, or a write that half-failed —
the hourly reconcile sweep rewrites **that line only** (`setPassCodeLine`), leaving every other
line byte-for-byte. Bookings with no stored code are deliberately left alone: rewriting every
live pre-change event at once would ask the door system to re-provision every booking in the
same hour.

### Guest communication

Every guest-facing mention — confirmation, reminder, manage page — shows the allocated code,
and only says "the last four digits of your mobile number" when `source` is `phone`.

### Still open

- ~~The door system must read `Pass Code:`~~ **Done, 3 Sep 2026** — live, with phone as the
  fallback.
- Permanent staff codes are not known to the allocator. `allocateDoorCode` takes an `avoid`
  list, so wiring a configured list in is one line once the DRA supplies the codes.
- Live bookings made before this change keep their phone-derived codes on the lock without a
  reservation here, so for up to 90 days a new booking's phone fragment could still collide
  with one of them — the failure that already existed, now shrinking rather than growing.

## Incidental finding, not ours to fix

The logs show a passcode currently failing to provision on both locks:

```
passcode 3193 is already in use on lock 3536180 by a manually-managed code
Failed to create passcode on lock 3670800: TTLock API error: failed or means no (code: 1)
```

A generated code has collided with a manually-set one, and the retry is not resolving it. That
is a real booking whose hirer may not be able to get in. Flagged because it was in front of us;
it belongs to the `calendartopasscode` project, not this one.

## Acceptance criteria

- [x] ~~The event format is verified against `calendarWebhook`'s parser~~ — `event-format.ts`,
      with `test/booking-event-format.test.ts` asserting against copies of its actual regexes.
- [ ] One real-calendar booking is confirmed to provision a passcode on both locks.
- [x] ~~Confirm which rooms are wired to the locks~~ — all three; Snooker has a third lock.
- [ ] A calendar-description purge exists somewhere and covers all three calendars.
- [ ] The historical backlog is dealt with as a one-off.
- [ ] The PII purge rewrites events and never deletes them.
- [ ] A deletion request is honoured in Firestore *and* in the synced Google Contacts.
