# 06 — Emails

Brevo, the same account the newsletter uses. The existing integration (`api/subscribe.ts`) is
the *contacts* API; this needs the **transactional** API, `POST https://api.brevo.com/v3/smtp/email`,
with the same `BREVO_API_KEY`.

`src/lib/raffle-email.ts` on the `raffle-feedback-1` branch is the working precedent for
composing and sending — follow its shape.

## Templates in the repo, not in Brevo

HTML lives in `src/lib/booking-email.ts` as functions returning `{ subject, html, text }`.
Version-controlled, reviewable in a diff, testable without network, and impossible to break by
someone editing a template in a vendor UI. Every email ships a plain-text alternative.

## Sender

`bookings@meadowbrookdartington.org`, display name "Meadowbrook Dartington". Must be a verified
Brevo sender before launch, with SPF and DKIM aligned — transactional mail that lands in spam
is worse than no mail, because the booker has paid and has no link.

Reply-to is the DRA's monitored address, so a reply from a confused booker reaches a person.

## The emails

| # | Trigger | To | Subject |
|---|---|---|---|
| 1 | Booking confirmed | booker | `Your booking is confirmed — Studio, Sat 5 Sep, 2pm` |
| 2 | Booking amended | booker | `Your booking has been changed — Studio, Sat 5 Sep, 3pm` |
| 3 | Booking cancelled | booker | `Your booking has been cancelled — refund of £48.00 on its way` |
| 4 | 24h before start | booker | `Tomorrow: Studio, 2pm–4pm` |
| 5 | Magic link requested | booker | `Your Meadowbrook booking links` |
| 6 | Any booking change | owner | `[Booking] New / Amended / Cancelled — Studio, Sat 5 Sep` |
| 7 | System alert | owner | `[Booking] Needs attention — MB-7K2QX4` |

### 1 — Confirmation

The most important email in the system. It is the receipt, the reminder, and the only way back
into the booking.

Must contain: room, date, day of week spelled out, start and end time, duration, price paid,
booking reference, the **manage link**, the cancellation policy in one sentence, arrival
instructions (`capacityNote`), the DRA's address and contact details.

Attach an `.ics` so it lands in the booker's own calendar. Set `METHOD:REQUEST`, `UID` to the
booking reference, and a sensible `SEQUENCE` so amendments update the same entry rather than
creating a second one.

### 3 — Cancellation

States the refund amount and that Square refunds typically take 5–10 working days to appear.
Say the number of days — the single most common "where's my money" support email is one that
a sentence in the cancellation email prevents.

### 4 — Reminder

Sent by the scheduled job (`08`). Includes the manage link so a late cancellation is one click
rather than a phone call. Skip it if the booking is cancelled, or if it was made less than 24
hours before its start.

### 6 — Owner notification

One email per change, to the DRA address, with a link to `/admin/bookings`. Batchable later if
volume makes it annoying; a per-event email is right at the current scale.

### 7 — System alert

Only for the things in `01`'s reconciliation table and `04`'s webhook orphans: a booking with
no calendar event, a calendar event edited by hand, an orphan payment, a failed refund. These
are rare and each one means money or a room is in an uncertain state, so they go to a human
immediately rather than to a dashboard nobody opens.

## Sending discipline

- **Never block a booking on an email.** Sending happens after the booking is durable. A send
  failure is logged and alerted; it never fails the request or rolls anything back.
- **Retry** transient Brevo failures three times with backoff, then alert.
- **Log every send** as `{ bookingRef, template, at, brevoMessageId }` on the booking, so
  "did they get the email" is answerable from the admin page.
- **Never include the raw token in a log line.** The link contains it; the log records that a
  link was sent.
- Booking emails are transactional and go to everyone who books. They are not marketing, they
  carry no unsubscribe, and they must not be sent through the newsletter list. If the booking
  form offers a newsletter opt-in, that is a separate, unticked checkbox writing to the
  existing Brevo list via the existing endpoint.

## Content and tone

Match the site: plain English, no exclamation marks, no "Hi there!". The DRA is a village
association, not a SaaS. Times as "Saturday 5 September, 2:00pm–4:00pm". Money as "£48.00".
Dates always with the weekday, because that is what people actually check.

## Acceptance criteria

- [ ] Every email renders correctly in plain text with the HTML stripped.
- [ ] The confirmation `.ics` imports cleanly into Google Calendar, Apple Calendar and Outlook.
- [ ] An amendment updates the existing calendar entry rather than adding a second one.
- [ ] A Brevo outage does not prevent a booking from completing.
- [ ] The manage link in every email opens the right booking.
- [ ] The cancellation email states both the refund amount and the expected timescale.
- [ ] No booking email contains an unsubscribe link or touches the newsletter list.
- [ ] SPF, DKIM and DMARC pass for `bookings@meadowbrookdartington.org` (verify with a real send before launch).
