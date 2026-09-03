# 16 — Newsletter opt-in during booking

Requested by the DRA on 3 Sep 2026. A hirer booking a room is one of the warmest
audiences Meadowbrook has — they have just chosen to spend money on the building —
and there is currently no moment where they are invited to hear from it again.

**Built 3 Sep 2026.** The DRA supplied the list: Brevo list **2**, "newsletter". This
records what was built and what is still open.

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

- Added to Brevo list `BOOKING_NEWSLETTER_LIST_ID` (**2**, "newsletter"), not the
  general contact pool, so the marketing audience is auditable and separable.

**Look up, then add — never upsert.** A single create-or-update call is one request
instead of two, and it is the wrong shape twice over: it would overwrite the
attributes of a contact who has been subscribed for years with whatever name someone
typed into a booking form, and it would report "created" for a person who was already
a subscriber, which is the one thing we might later need to be certain about. So:
`GET /contacts/{email}` → 404 creates with the list attached, already on the list does
nothing at all, otherwise `POST /contacts/lists/2/contacts/add`.

**`emailBlacklisted` is never sent.** Brevo holds the unsubscribe state on the
contact, and adding an unsubscribed person to a list leaves them unsubscribed — which
is correct. Sending `emailBlacklisted: false` would silently undo an opt-out, so a
test asserts that field never appears in a request body.
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

## Still open

1. ~~Which Brevo list?~~ **List 2, "newsletter"**, decided by the DRA on 3 Sep 2026.
   Hirers are not separated from the general newsletter audience, so "how engaged are
   room hirers" is not answerable from Brevo alone. The booking record carries the
   flag, so it stays answerable from our side.
2. **Double opt-in?** Not implemented. A ticked box is legally sufficient, and this
   sends nothing extra. Worth revisiting if list hygiene ever matters more than
   conversion.
3. **Only at booking.** The amend and cancel pages do not ask. Asking repeatedly is
   the fastest way to make it annoying, and someone amending a booking is not in a
   receptive frame of mind.
4. The privacy policy should mention that booking is where the invitation appears.
   Part of the outstanding policy work in `12`.

## Acceptance criteria

- [x] The box is never pre-ticked, in any state of the form. *(asserted against the
      component source, not just intended)*
- [x] A booking completes identically whether it is ticked or not — the Brevo call
      happens after the booking is confirmed and its failure is caught and alerted.
- [x] Brevo being down does not fail or delay a booking.
- [x] The booking record stores the consent, its timestamp and the wording shown.
- [x] Only a strict `true` counts as opting in.
- [x] An unsubscribed contact is never resubscribed.
- [x] Local development cannot add anyone to the real list.
- [x] The admin booking detail shows the flag.
- [ ] The privacy policy describes it. Outstanding with the rest of `12`.
