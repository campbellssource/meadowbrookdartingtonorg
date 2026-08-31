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

### 2. Contact scrubbing works — on the Lounge

`cleanupExpiredContacts` deletes the synced Google Contact 7 days after a booking ends, and the
`calendarWebhook` contact sync also strips the detail from the **calendar event description**.
It is recent, so it has no backfill: bookings from before it was deployed still carry whatever
Acuity wrote.

Measured on the Lounge, taking "still has a `Name:` field" as unscrubbed:

| Lounge booking | Age | Scrubbed? |
|---|---|---|
| 2 Jul 2026 | 59d | No — predates the tool |
| 5 Jul 2026 | 56d | No — predates the tool |
| 6 Aug 2026 | 24d | **Yes** — name, email and price gone |

So the tool does what it says. The residue is historical, exactly as expected for something
new.

### 3. The Studio and Snooker Room look uncovered ⚠️

This is the part recency does **not** explain. Both functions carry `GOOGLE_CALENDAR_ID` set to
a single calendar — the Lounge. Taking bookings that ended 8–16 days ago — past the 7-day
retention, and after the function's last update on 14 Aug — every one still carries the full
Acuity block, name and mobile number included:

| Room | Bookings in window | Still carrying a name |
|---|---|---|
| Lounge | 0 | — (no bookings to judge by) |
| Studio | 1 | 1 |
| Snooker | 8 | 8 |

Nine for nine. These are recent enough that the tool was already running, so if those calendars
were in scope they would have been scrubbed. Combined with the single-calendar env var, the
likeliest reading is that **only the Lounge is wired up**.

Worth confirming rather than assuming — `updateTime` is a deploy timestamp, not proof of when
scrubbing began, and there may be watch channels the env vars do not show. But if it holds, the
Snooker Room is the calendar carrying the most personal data and the least scrubbing.

**Question for the DRA.** Logged as question 23. It also decides whether door passcodes are
issued for all three rooms or only the Lounge — the same env var governs both.

### 4. Extend that tool rather than building a second one

`12` proposed a PII purge inside the booking system. That was written before this system was
found, and it is now the wrong shape: two independent jobs rewriting the same calendar events,
on different schedules, with different ideas of what a booking is.

Better: **extend `calendartopasscode`'s existing scrubber to all three calendars.** It already
does the work, already holds the calendar credentials, and already knows the Acuity format. The
booking system should not grow a competing purge.

That leaves the historical backlog — everything from before the tool — as a separate one-off
tidy-up, not a recurring job.

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

- [ ] The event format written in Phase 2 is verified against `calendarWebhook`'s parser.
- [ ] One real-calendar booking is confirmed to provision a passcode on both locks.
- [ ] It is confirmed which rooms are wired to the locks and the scrubber (question 23).
- [ ] Scrubbing covers all three calendars, wherever that job ends up living.
- [ ] The historical backlog is dealt with as a one-off.
- [ ] The PII purge rewrites events and never deletes them.
- [ ] A deletion request is honoured in Firestore *and* in the synced Google Contacts.
