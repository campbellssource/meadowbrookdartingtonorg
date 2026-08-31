# 12 — Privacy policy changes

The policy lives in a Google Doc, published via the `/privacy` redirect in `astro.config.mjs`:
`docs.google.com/document/d/1V94cmxs0Nix99-eZzGKzUx9z8Bzd0ynNno5waPc0hQQ`

Not a repo file, so this is copy-paste-ready text rather than a diff.

> Not legal advice. This is an engineer reading the policy against what the code actually does
> and reporting where they disagree. Someone with data-protection responsibility should approve
> the wording before it is published.

---

## Part 1 — Already wrong, before this project changes anything

Found while checking what the booking system would add. These are live inaccuracies about who
handles people's data today, and they matter more than anything in Part 2.

### 1. The payment processor is named as Stripe. It is Square. ⚠️

Sections 2, 3, 4 and 5 all say Stripe. The site uses **Square** — `api/donate.ts` posts to
`connect.squareup.com`, and `PUBLIC_SQUARE_APPLICATION_ID` is in the production deploy.

This is the most consequential error in the document. Naming the wrong recipient of card data
misstates where personal data goes, and it is exactly what a subject-access request or a
complaint would test. **Fix regardless of whether the booking system ever ships.**

Replace every occurrence of "Stripe" with "Square". Suggested phrasing for section 5:

> **Payment processing (Square):** Card payments are processed by Square. We never see or store
> your full card details — they are captured directly by Square. We retain a payment reference,
> the amount and the date so that we can reconcile our accounts and issue refunds.

### 2. The website is named as Squarespace. It is not. ⚠️

Sections 2, 5 and 9 say the site is hosted on Squarespace and link to Squarespace's cookie
policy. The site is an Astro application in a container on **Google Cloud Run**, in
`europe-west2` (London). Nothing is served by Squarespace.

The cookie link is worse than merely wrong: it points readers at a description of cookies the
site does not set. Suggested replacement:

> **Website hosting:** Our website is hosted on Google Cloud Run in the United Kingdom
> (`europe-west2`). Server logs, which may include your IP address, are retained for 30 days
> for security and troubleshooting.

Then have someone confirm what cookies the site *actually* sets before rewriting section 9 —
that needs checking in a browser, not guessing here.

### 3. Acuity is not mentioned at all

Acuity Scheduling currently receives the name, email, phone number and booking details of
everyone who books a room, and is a US-headquartered processor. It should be listed for as
long as it is in use. Since the DRA intends to run both systems in parallel for a while, this
stays true past launch — it does not disappear when the new system arrives.

### 4. Unfilled placeholders

Three square-bracket prompts are published as-is:

| Section | Placeholder |
|---|---|
| 6, Data Security | `[mention specific security measures you have in place...]` |
| 9, Cookies | `[link to your cookie policy if you have one...]` |
| 11, Children's Privacy | `[insert relevant age, e.g., 13]` |

Section 6 reads as though the DRA has not thought about security, which is unfair — the site
runs HTTPS-only, holds no card data, uses no long-lived service-account keys, and stores
booking data in Google Cloud in the UK. Say so.

For section 11, the UK age of consent for information-society services is **13**.

---

## Part 2 — What the booking system adds

Only needed when the new system goes live.

### Section 2 — What Personal Information We Collect

Replace the existing **Booking Information** bullet:

> **Booking Information:** When you book one of our rooms we collect your name, email address
> and phone number, the room, date, time and length of your booking, anything you tell us about
> how you intend to use the room, and a record of the payment (amount, date and a reference —
> never your card details). Your name and booking details are also written to the room's Google
> Calendar so that our volunteers can see what the building is doing on any given day.

Add:

> **Booking Access Links:** So that you can change or cancel a booking without creating an
> account, we email you a secure single-purpose link. Your browser also stores a record of your
> own bookings on your device so that you can find them again. This stays on your device, is
> readable only by you, and can be cleared at any time through your browser settings.

### Section 5 — How We Share Your Personal Information

Add to the service-provider list:

> - **Google (Cloud Run, Firestore, Google Calendar)** — hosting, booking records and room
>   calendars, all in the United Kingdom.
> - **Square** — card payment processing.
> - **Brevo** — sending booking confirmations, reminders and cancellation emails.

### Section 7 — Data Retention

The current text says booking contact details are kept "in a calendar for 90 days". That will
no longer be the whole picture, because a paid booking is also a financial record. Suggested
replacement:

> **Room bookings.** We keep the booking record — including your name, contact details, the
> booking itself and the payment reference — for **7 years**, because a paid booking forms part
> of the charity's financial records and we are required to retain those. Your name and contact
> details are removed from the room's Google Calendar **90 days** after the booking has taken
> place; the calendar entry itself remains, showing only that the room was in use. Secure
> booking-access links expire and are deleted. Where a booking is started but never paid for,
> the details are deleted within 24 hours.

⚠️ **This clause creates build work.** "Removed from the calendar after 90 days" is a promise
the code has to keep — it needs a scheduled job that strips personal detail from calendar
events older than 90 days while leaving the occupancy block. It does not exist yet and is not
in any phase. Either build it or do not make the promise; a retention promise nothing enforces
is worse than a longer, honest one. Logged as question 21.

Confirm the 7 years with whoever prepares the DRA's accounts — 6 is also defensible depending
on the basis used. Pick one and let the code match it.

### A new section — Our Legal Basis

The policy currently never states a lawful basis, which Article 13 requires. Worth adding
whether or not the booking system ships:

> **Our legal basis for using your information**
>
> - **To perform a contract with you** — taking and managing your booking, sending you
>   confirmations, reminders and cancellation notices, and processing refunds.
> - **To comply with a legal obligation** — keeping financial records of payments received.
> - **For our legitimate interests** — keeping the building secure, understanding how our rooms
>   are used, and notifying our own volunteers of bookings so the building runs smoothly.
> - **With your consent** — newsletters and marketing. You can withdraw consent at any time.

### Section 4 — How We Use Your Personal Information

The existing bullet is close but does not cover the reminder email or internal notifications:

> **To process bookings:** To manage and confirm your room bookings, to send you a confirmation,
> a reminder before your booking, and confirmation of any change, cancellation or refund, to
> let our volunteers know the room is in use, and to contact you if there is a problem with your
> booking or the room.

---

## What to do with this

1. **Now, independent of the booking system:** Part 1. Stripe→Square and Squarespace→Google are
   live inaccuracies about where personal data goes.
2. **Before the booking system launches:** Part 2, plus a decision on the 90-day calendar purge
   — build the job or soften the promise.
3. **At the same time:** add a "last updated" date. Section 12 promises one and the document
   does not carry one.

Claude can apply all of this to the Google Doc directly on request — it has edit access, and
Docs version history makes it reversible. Held back deliberately: it is a published legal
document, and the Stripe/Square correction in particular deserves a human deciding it rather
than discovering it changed.

## Acceptance criteria

- [ ] No occurrence of "Stripe" or "Squarespace" remains in the policy.
- [ ] Acuity is listed while it is still in use, and removed when it is switched off.
- [ ] All three `[...]` placeholders are resolved.
- [ ] The policy names Google, Square and Brevo as the booking system's processors.
- [ ] A stated lawful basis exists for booking data.
- [ ] Every retention period in the policy is one the code actually enforces.
- [ ] The document carries a "last updated" date.
