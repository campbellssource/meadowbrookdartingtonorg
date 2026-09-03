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

### 3. The door code is the last four digits of the booker's phone number

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

## Where should code-setting live, now that we own the booking system? — 3 Sep 2026

The DRA raised this: the original design had to wait for a calendar event because
that was the only way to learn a hirer's phone number. We now know it at the moment
of booking, so the round-trip is no longer forced. They also report the integration
is **fragile and fails often**, and named the two causes that matter.

### Keep it in `calendartopasscode`. The reason is coverage, not preference.

The calendar trigger serves **every** event, not just ours: Acuity's while it still
runs, and — more importantly — **hand-made committee events**. Someone is given
access for a one-off, and a volunteer creates a calendar entry with a phone number
in it. The evidence is already in this file: a Lounge event whose entire description
was `Phone: +440000002216`, made for no other purpose than to grant a code.

Move code-setting into the booking system and every one of those silently stops
working. That is a much worse failure than the ones being fixed. The contact sync is
a second, independent reason: it is address-book plumbing, nothing to do with room
booking, and it belongs where it is.

### The two failures are not location problems

Neither is caused by where the code is set, so moving it would fix neither.

**1. A booker with two bookings.** The code is derived per booking, but a lock holds
code *values*, not bookings. The same person booking twice produces the same value
twice, and TTLock refuses the duplicate. Nor would anyone want two codes to remember.

This is an **allocation** problem. The fix is one passcode per *(person, lock)* with
a validity window that covers all their bookings — on a second booking, extend or
modify the existing passcode rather than create another. Deletion has to become
reference-counted to match: `cleanupExpiredCodes` must not remove a code because one
booking ended while another is still live.

**2. The gateway or wifi is down when the code is set.** Creation is fire-and-forget
at event time, which assumes the lock is reachable at that exact moment. Often it is
not, and the retry loop observed on 3 Sep 2026 hammered the same rejection every 40
seconds without ever succeeding.

This is a **delivery** problem, and the shape of the fix is to stop treating a code
as an event to handle once and start treating it as **desired state to converge on**.
A periodic reconciler compares "codes that should exist over the next N days" against
"codes actually on the lock" and fixes the difference. Retries stop being a special
case — they are simply the next pass. It is the same move that made the booking
system's own payment reconciliation reliable.

### What our side should change regardless

**We email a code we have never verified.** `doorCodeFor(phone)` computes an
assumption and the confirmation email states it as fact. If the lock rejected it, was
unreachable, or assigned something else, the hirer arrives holding a number that was
never on the door — and everything in our system says the booking is fine.

Two levels, and the first is worth doing on its own:

- **Verify before arrival.** A check shortly before the booking starts, asking whether
  a code actually exists for it, alerting `it@` when it does not. This needs no change
  in the other project and turns a silent failure into a known one while there is
  still time to phone someone.
- **Make the lock system the authority on the code, and have it report back** — a
  webhook to the booking site, or an extended property on the calendar event. Then we
  only ever state a code that exists, and the case where two different people's
  numbers end in the same four digits stops being unsolvable: the lock system picks
  an alternative and tells us what it chose.

### Sequence, smallest first

1. Verify-before-arrival alert. Ours alone, no coordination.
2. One code per person per lock, with a merged validity window. Fixes the common case.
3. Reconciler replacing fire-and-forget retries. Fixes the flaky-gateway case.
4. Report-back contract, so emails only ever carry a real code.

The "passcode is too simple" rejection (`5555`, `1234`) is real but rare, and the DRA
has deprioritised it. Step 4 makes it a non-issue for free.

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
