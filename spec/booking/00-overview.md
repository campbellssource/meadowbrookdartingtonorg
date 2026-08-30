# 00 — Overview

## Why

Acuity Scheduling is a paid subscription doing a job the site can do itself. It also owns the
booking UX, which sits in an iframe that doesn't match the site's brand, can't be styled, and
can't be made properly accessible. Replacing it removes the recurring cost and puts booking
inside the site we control.

The one thing Acuity does that we must not lose: it syncs to the three Google Calendars, so
the committee can block a room for a private function just by creating a calendar event. That
behaviour is the reason the current setup works, and it survives this rewrite intact.

## The three bookable rooms

| Room | Facility slug | Google Calendar ID |
|---|---|---|
| Snooker Room | `snooker-room` | `c_7d03780450348bae6a9fbe620e8d8d70254f5da1f058ca9a631e89a820850c71@group.calendar.google.com` |
| Studio (Large room) | `large-room` | `c_c5f1e9f56d6290965b22e21e136bff0cc2bfefba5fd641b9902efe67a31b5cc7@group.calendar.google.com` |
| Lounge (Small room) | `small-room` | `c_33f4213aac4c1fe8fb9a7a79b063d038b983bc79549f43fdb6bc93847c302977@group.calendar.google.com` |

All three are `Europe/London`. The calendar names match today's Acuity `bookingCategory`
values exactly, which is what makes the swap tractable.

## Locked decisions

These were decided at kickoff. Everything downstream assumes them; changing one means
revisiting the specs that depend on it.

| # | Decision | Consequence |
|---|---|---|
| D1 | **Calendar is the occupancy source of truth; Firestore holds booking records** | Any event on a room calendar makes the room unavailable, whoever created it. Firestore never contradicts the calendar — it annotates it. |
| D2 | **New dedicated GCP project for booking infra** | Cross-project IAM from the Cloud Run runtime SA. See `08-infrastructure.md`. |
| D3 | **Pay in full at booking, by card, via Square** | No pending/unpaid bookings ever reach the calendar. A slot is either free or paid for. |
| D4 | **Any cancellation before the start time is refunded in full** | Automatic Square refund. No cancellation window to configure, no partial-refund arithmetic on cancel. Amending to a cheaper slot refunds the difference; amending to a dearer one charges it. |
| D5 | **No accounts. Magic links + local storage** | Identity is "controls this email address". Tokens are signed, revocable, and scoped to a single booking. |

### A note on D4

Full refund up to the start time is generous, and it means someone can hold a Saturday
evening Studio slot and release it an hour before at no cost. That is a real revenue risk, not
a hypothetical one — it's the standard reason venues have a cancellation window.

Building it as decided, but the refund rule is implemented as a **single policy function**
(`refundFor(booking, now)` in `src/lib/booking-policy.ts`) with the window as a config value,
so introducing "free until 48h before, then nothing" later is a one-line config change and no
refactor. Flagged for the DRA in `OPEN-QUESTIONS.md`.

## User flows

### Site owner

| Flow | How it works |
|---|---|
| Set rooms | Keystatic — the existing `facilities` collection, `bookable` variant, gains a `booking` config block. Committed to git, deployed on merge. |
| Set availability | Two layers. **Recurring** opening hours live in Keystatic per room. **One-off** blocks are just Google Calendar events, exactly as today. |
| Set booking rules | Keystatic per room: hourly rate, peak rate, minimum and maximum duration, slot granularity, buffer between bookings, minimum notice, maximum advance. |
| See bookings | `/admin/bookings` — filterable list, with the calendar event and Square payment linked from each row. |
| Income analysis | `/admin/reporting` — revenue by room by month, occupancy rate, average booking length, refunds. CSV export for the treasurer. |

### Room booker

| Flow | How it works |
|---|---|
| Book a room (one-off) | Pick room → date → slot → duration → details → card. Confirmed only once Square settles. |
| Amend: another time | Magic link → pick a new slot → price recalculated → difference charged or refunded → calendar event moved. |
| Amend: duration | Same path; duration is just another field on the same amend form. |
| Cancel | Magic link → confirm → full Square refund → calendar event deleted → confirmation email. |

## In scope for v1

- One-off bookings of the three rooms, paid in full by card.
- Availability derived live from Google Calendar plus per-room rules.
- Self-service amend and cancel via magic link, with automatic money movement.
- Transactional email for confirm, amend, cancel and a 24-hour reminder.
- Owner admin: booking list, income reporting, CSV export, manual refund.
- Running in parallel with Acuity until the subscription is cancelled.

## Out of scope for v1

Deliberately excluded. Each is a real thing someone will ask for; none blocks launch.

- **Recurring / block bookings.** The Studio copy already advertises "hourly or recurring
  hire", and regular hirers are likely the DRA's most valuable customers. Today that is almost
  certainly handled off-platform (a phone call and a calendar entry), and it can carry on being
  handled that way. Designed around, not built — `01-data-model.md` reserves a `seriesId` field.
- **Accounts, saved cards, or a booking history page** beyond what local storage remembers.
- **Discount codes, member rates, or credit balances.**
- **Deposits, invoicing, or bank transfer.** Card only.
- **Bookings that span midnight.** Rooms close before midnight; the model assumes a booking
  sits inside one local calendar day.
- **Multi-room bookings in one transaction.** Book them one at a time.
- **The non-bookable facilities** (pool, MUGA, playing fields, bike track and the rest) — they
  are unchanged.
