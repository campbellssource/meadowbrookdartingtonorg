# 10 — Room hire terms

Draft terms for `/room-hire-terms`, linked from the booking form and from every confirmation
email. The booking form requires an explicit tick against these before payment, and the booking
record stores which version was agreed to (`termsVersion` on the booking document, `01`).

> **This is a draft for the committee, not legal advice.** The cancellation, pricing and
> conduct clauses are the DRA's own decisions and are safe to set here. The **liability,
> insurance and safeguarding** clauses (9, 10, 11) are the ones where a wrong word is
> expensive — they should be read by whoever handles the DRA's insurance, and checked against
> the policy's actual requirements, before this page goes live. Marked ⚠️ below.

Written to be edited: once built, this lives in Keystatic (`src/content/misc-pages/`) so the
committee can change it without a deploy. Changing it bumps `termsVersion`.

---

## Booking the room

**1. Booking and payment.** Rooms are booked and paid for in full online. A booking is only
confirmed once payment has gone through — until then the slot stays available to others. You
will get a confirmation email with a link to manage your booking. Current rates:

| Room | Rate |
|---|---|
| Snooker Room | £7.50 per hour |
| Studio (Large room) | £10.00 per hour |
| Lounge (Small room) | £10.00 per hour |

Bookings are made in 30-minute increments.

**2. Your booking time is the time you have.** Please include your setting-up and clearing-away
in the time you book. Another booking may follow yours, so the room needs to be clear and ready
by the time your slot ends.

**3. Changing or cancelling.** Use the link in your confirmation email.

**More than 1 hour before your booking starts**, you can do either:

- **Cancel** — refunded in full, automatically.
- **Change the time or length** — the price is recalculated. If it costs more you pay the
  difference; if it costs less we refund the difference.

**Within 1 hour of the start, the booking is fixed.** It can no longer be changed, and
cancelling it is not refunded. If something has genuinely gone wrong, email us and we will do
what we can — we would rather know the room is free than have it sit empty.

**If you book a room that starts within the hour** — which is common and welcome for the
Snooker Room — that booking is fixed from the moment you make it: it cannot be changed or
refunded, because it is already inside the window. We will tell you this on the booking form
before you pay.

**4. If we have to cancel.** Very occasionally we may need to cancel a booking — a burst pipe,
a power cut, an emergency closure. You will get a full refund and as much notice as we can
manage. We cannot cover costs beyond the hire fee itself.

## Using the room

**5. Leave the room as you found it.** This is the big one, and it is what keeps the hire
charges as low as they are. Put furniture back where it was, take your rubbish with you or put
it in the bins provided, wipe up spills, and turn the lights and heating off behind you. If the
room needs cleaning or resetting beyond normal use, we may charge for the time it takes.

**6. Look after the building.** Please don't fix anything to the walls, floors or ceiling
without asking us first. Tell us about any damage or breakage — including accidental — as soon
as you can. Accidents happen and we would far rather know; the cost of repair may be charged to
the hirer.

**7. Capacity, access and the practical bits.**

- Please stay within the room's stated capacity. It is a fire safety limit, not a guideline.
- Know where the fire exits are. Never prop fire doors open or block an exit.
- **No smoking or vaping** anywhere in the building.
- **The Studio is on the first floor with stair access only** and is not step-free. Please bear
  this in mind when inviting people, and talk to us if access is a concern.
- **The Studio has no sound system** — bring your own speaker.
- **Parking** on site is Dartington Hall Trust paid parking and is not included in your hire.
- Assistance dogs are welcome. Other animals only by prior arrangement.

**8. Noise and neighbours.** Meadowbrook sits close to homes. Please keep noise reasonable,
especially after 9pm, and keep doors and windows shut if you are playing music.

## Responsibility ⚠️

> Clauses 9–11 need checking against the DRA's insurance policy before publication.

**9. ⚠️ You are responsible for your group.** The person who makes the booking is responsible
for everyone attending, for their behaviour, and for their safety while in the room. The DRA
does not supervise hirers' activities.

**10. ⚠️ Under-18s and vulnerable adults.** If your booking involves children or vulnerable
adults, you are responsible for their supervision and for any safeguarding, DBS checks and risk
assessment that your activity requires. The DRA does not provide supervision and does not check
this on your behalf.

**11. ⚠️ Insurance and liability.** If you are hiring the room to run a business, a class or a
public event, you must hold your own public liability insurance and be able to show it to us on
request. The DRA is not responsible for loss of or damage to your belongings or equipment left
in the building. Nothing in these terms limits our liability for death or personal injury
caused by our negligence, or for anything else that cannot lawfully be excluded.

## Other

**12. Alcohol and public events.** Please talk to us before selling alcohol or ticketing a
public event on the premises — licensing may apply, and it is our licence.

**13. Equipment.** Where equipment is provided — snooker cues, tables, chairs — please treat it
with care and put it back. The Snooker Room's bar downstairs is not always open; it keeps its
own hours and is not part of your booking.

**14. Behaviour.** We may end a booking, without refund, if the room is being used in a way
that is unsafe, that damages the building, or that is abusive towards staff, volunteers or
other users.

**15. Your data.** We keep your name, email, phone number and booking details in order to
manage your booking and our rooms. See the [privacy policy](/privacy). We do not store your
card details — payments are handled by Square.

**16. Questions.** Email bookings@meadowbrookdartington.org.

---

## Build notes

- Terms are a Keystatic-managed page so the committee can edit them; `termsVersion` is a field
  on that page, bumped by hand when a change is material.
- The booking form links here in a new tab and requires an explicit checkbox. The checkbox is
  not pre-ticked.
- `termsVersion` is written onto the booking document at creation, so a dispute can be settled
  against the terms as they stood that day rather than as they stand now.
- Clause 3's "within the hour" warning is rendered from `refundFor(booking, 'cancel', bookedAt)`
  (`04`), not hardcoded — the page and the actual refund behaviour cannot drift apart.
- Clauses 9–11 must not be published until insurance-checked. Track as a launch blocker in
  `OPEN-QUESTIONS.md`.

## Acceptance criteria

- [ ] Booking is impossible without ticking the terms box.
- [ ] `termsVersion` is stored on every booking document.
- [ ] A booking starting within the hour shows the non-refundable warning before payment.
- [ ] A booking starting tomorrow does not show that warning.
- [ ] The rates on this page are generated from room config, not typed in twice.
