# 11 — Running the whole thing locally

**Yes — a full click-through runs on `localhost`:** browse availability, pick a slot, pay with a
test card, get the confirmation email, follow the magic link, amend the booking, cancel it, watch
the refund go through. No deploy, no staging environment.

That only stays true if it is designed for from the first commit, because the default version of
this system reaches into three live things — the real room calendars, real inboxes, and real
Firestore. This file is what stops that.

## What is real and what is not

| Piece | Locally | Notes |
|---|---|---|
| **Google Calendar** | Real API, **dev calendars** | Verified working via ADC impersonation (`08`). Points at throwaway calendars, never the live rooms. |
| **Square** | Real API, **sandbox** | Full tokenisation and 3-D Secure with test cards. Refunds work. |
| **Firestore** | **Emulator** | `FIRESTORE_EMULATOR_HOST` is honoured by the client library automatically — no code branch. |
| **Email (Brevo)** | **Console transport** | Rendered email printed to the terminal. Nothing is sent. |
| **Cron jobs** | `curl` by hand | No scheduler locally; hit the endpoints directly. |
| **Admin sign-in** | Real Google OAuth | Needs `localhost` added as a redirect URI. |

Two substitutions, both deliberate. Everything that carries risk — the calendar writes, the
money, the availability arithmetic — runs against the real API.

## The three hazards, and the fix for each

### 1. Writing test bookings onto live room calendars

The obvious failure. A dozen "Test Booking" events on the real Studio calendar is not just
untidy — under D1 the calendar *is* the source of truth for occupancy, so junk events make real
rooms look busy and block real hirers.

**Fix.** Three dev calendars, created by and owned by `booking-app` itself (it can call
`calendars.insert`; it needs no sharing to use what it owns, and can share them back to a human
with `acl.insert` if you want to watch them). Calendar IDs resolve through:

```
resolveCalendarId(room) = process.env[`BOOKING_CALENDAR_${room.key.toUpperCase()}`]
                       ?? room.calendarId   // from Keystatic
```

`.env` sets the three overrides; production sets none and uses the Keystatic values.

**And a guard, because an env override is one typo from silently pointing at production.**
`assertWritable(room)` in `config.ts` throws if a live room calendar is about to be *written*
while `NODE_ENV !== 'production'`, against a hardcoded deny-list of the three production IDs.
Every calendar write calls it.

**Writes, not reads** — this started life as a boot-time check and was wrong that way. Reading a
live calendar from a laptop is useful and harmless: it is exactly how Phase 1's availability
output gets compared against Acuity. Refusing that would have blocked the acceptance test the
phase exists to pass. It is the writes that put junk on a real room's calendar, so that is
where the refusal belongs.

### 2. Emailing real people

Booking test data will contain real addresses — your own, and sooner or later a real hirer's
copied from a live booking while debugging. `BOOKING_EMAIL_TRANSPORT=console` prints the
rendered email to the terminal instead of calling Brevo.

This also makes magic links *easier* to test, not harder: the link is right there in the
terminal to paste, no inbox round-trip. `brevo` is the only other value, and the send function
must throw rather than default to `brevo` if the variable is unset in dev.

### 3. Test bookings in the production database

The emulator handles this. `gcloud emulators firestore start`, set `FIRESTORE_EMULATOR_HOST`,
and the Google client library routes to it with no code change. State is wiped on restart,
which is what you want mid-build.

**Known gap:** the emulator does not enforce composite indexes and does not run TTL deletion. So
"works locally" does not prove the `holds.expiresAt` sweep works, and it does not prove a query
has an index. Those are only exercised against the real database — call them out in the Phase 2
and Phase 3 checks rather than assuming local success covers them.

## Setup

### `gcloud auth login` is not enough — and the error will not tell you that

gcloud keeps **two separate credential stores**, and the booking code uses the one
`gcloud auth login` does not touch:

| Store | Refreshed by | Used by |
|---|---|---|
| CLI credential | `gcloud auth login` | `gcloud` commands, `gcloud auth print-access-token` |
| Application Default Credentials | `gcloud auth application-default login` | **`google-auth-library`, i.e. this app** |

So `gcloud` can be working perfectly from the shell while every calendar read from
the dev server fails. The failure surfaces as:

```
unable to impersonate: {"error":"invalid_grant",
  "error_description":"reauth related error (invalid_rapt)"}
```

which names neither store and reads like a permissions problem. It is not — it is an
expired ADC. Fix:

```sh
gcloud auth application-default login
```

Worth knowing that ADC expires on its own schedule, so this will recur, and it will
recur looking like something else.

```sh
# One-off
gcloud auth application-default login          # NOT `gcloud auth login` -- see above
gcloud components install cloud-firestore-emulator
node scripts/booking-dev-calendars.mjs --create   # makes the 3 dev calendars, prints their IDs

# Every session
npm run dev:booking     # emulator + astro dev, concurrently
```

`.env` additions:

```sh
BOOKING_PROJECT_ID=meadowbrook-booking
BOOKING_IMPERSONATE_SA=booking-app@meadowbrook-booking.iam.gserviceaccount.com
FIRESTORE_EMULATOR_HOST=localhost:8080
BOOKING_EMAIL_TRANSPORT=console
BOOKING_CALENDAR_SNOOKER=<dev calendar id>
BOOKING_CALENDAR_STUDIO=<dev calendar id>
BOOKING_CALENDAR_LOUNGE=<dev calendar id>
PUBLIC_BOOKING_SQUARE_ENVIRONMENT=sandbox
PUBLIC_BOOKING_SQUARE_APPLICATION_ID=<sandbox app id>
PUBLIC_BOOKING_SQUARE_LOCATION_ID=<sandbox location id>
BOOKING_SQUARE_ACCESS_TOKEN=<sandbox token>
BOOKING_MAGIC_LINK_SECRET=<openssl rand -base64 32>
BOOKING_CRON_SECRET=<openssl rand -base64 32>
```

Add `http://localhost:4321/admin/auth/callback` to the OAuth client's authorised redirect URIs
alongside the production one, so `/admin` signs in locally through the real flow.

## Square sandbox test cards

| Outcome | Card |
|---|---|
| Success | `4111 1111 1111 1111` |
| 3-D Secure challenge | `4310 0000 0000 0055` |
| Declined | `4000 0000 0000 0002` |

Any future expiry, any CVV, postcode `SW1A 1AA`. The 3-D Secure card is worth using on every
pass — SCA is mandatory in the UK, `/donate` already has bespoke handling for the
`CARD_DECLINED_VERIFICATION_REQUIRED` decline, and it is the failure most likely to reach
production untested.

## The full click-through

The route to walk before calling any phase done:

1. `/facilities/snooker-room` → availability grid renders from the dev calendar.
2. Drop an event on the dev calendar by hand → refresh → that slot has gone. *(Proves D1.)*
3. Book a slot → pay with `4310 0000 0000 0055` → complete the 3-D Secure challenge.
4. Terminal prints the confirmation email. Dev calendar has one new event. Emulator has one
   booking, `status: confirmed`.
5. Follow the manage link from the terminal → amend to a **longer** slot → pay the difference.
6. Amend to a **shorter** slot → partial refund. Check it in the Square sandbox dashboard.
7. Cancel → full refund, calendar event gone, booking `status: cancelled`, history intact.
8. Book a snooker slot **starting in 30 minutes** → the non-refundable warning appears before
   payment (`10`) → book it → the manage page offers no refund on cancel.
9. `curl -H "X-Cron-Secret: …" localhost:4321/api/booking/cron/reminders` → reminder email in
   the terminal.

Step 8 is the one that will be skipped and is the one most worth doing: it is the only path
that exercises `minNoticeHours: 0` and the cancellation window interacting, and it is a
*money* behaviour that a hirer will notice before we do.

## Acceptance criteria

- [ ] `npm run dev:booking` starts the emulator and the dev server together.
- [ ] With `.env` as above, the nine steps complete without touching a live calendar, a real
      inbox, or production Firestore.
- [ ] Dev boot fails loudly if a resolved calendar ID is a production room calendar.
- [ ] The email send function throws, rather than sending, if `BOOKING_EMAIL_TRANSPORT` is unset
      outside production.
- [ ] `scripts/booking-dev-calendars.mjs --destroy` cleans up the dev calendars.
