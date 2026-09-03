# 16 — Newsletter opt-in during booking

Requested by the DRA on 3 Sep 2026. A hirer booking a room is one of the warmest
audiences Meadowbrook has — they have just chosen to spend money on the building —
and there is currently no moment where they are invited to hear from it again.

Not built. This is the design, and the questions worth settling before it is.

## The shape of it

A single unticked checkbox on the details step, beneath name/email/phone:

> ☐ Email me occasionally about what's on at Meadowbrook. No more than monthly, and
> you can unsubscribe from any email.

**Unticked, always.** Pre-ticked boxes are not consent under UK GDPR, and this is the
one detail that turns a nice-to-have into a compliance problem. The booking must
complete identically whether it is ticked or not — consent is never a condition of
service, and the checkbox must sit visually apart from the terms tickbox so the two
are not read as one.

## Where the consent goes

Brevo already sends every booking email, so the contact usually exists there
already as a transactional recipient. Opting in means **adding them to a marketing
list**, which is a different thing from having emailed them a receipt.

- Add to a named Brevo list (`BOOKING_NEWSLETTER_LIST_ID`), not the general contact
  pool, so the marketing audience is auditable and separable.
- Record the consent on the booking document: `newsletterOptIn: boolean`, plus the
  timestamp and the exact wording shown. **The wording matters**: proving consent
  means proving what they agreed to, and the sentence above will be edited one day.
- A failure to reach Brevo must never fail the booking. Queue it, log it, alert
  `it@` — the hirer has paid and their room is booked; a marketing list is not worth
  a 500.

## What this changes elsewhere

- **Privacy policy** (`12`) already lists "with your consent — newsletters and
  marketing" as a lawful basis, so the basis is covered. It should also say that
  booking is where the invitation appears, and that declining changes nothing.
- **Admin** (`07`) should show the flag on the booking row, because someone will ask
  "did they opt in" and the answer must not be "check Brevo".
- **Data export**: an opted-in contact who later unsubscribes in Brevo is
  unsubscribed there, not here. The booking record is evidence of what was agreed on
  that day, not a live subscription state. Do not read it as one.

## Open questions

1. Which Brevo list? Is there an existing one the newsletter already goes to, or
   should hirers be their own list so their engagement can be seen separately?
2. Does the DRA want a double opt-in confirmation email, or is the ticked box
   enough? A tick is legally sufficient; double opt-in is better hygiene and costs
   one more email.
3. Should the amend/cancel pages offer the same invitation, or only the first
   booking? Asking repeatedly is the fastest way to make it annoying.

## Acceptance criteria

- [ ] The box is never pre-ticked, in any state of the form.
- [ ] A booking completes identically whether it is ticked or not.
- [ ] Brevo being down does not fail or delay a booking.
- [ ] The booking record stores the consent, its timestamp and the wording shown.
- [ ] The admin booking row shows the flag.
- [ ] The privacy policy describes it before it ships.
