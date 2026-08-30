# Open questions

Things the DRA must decide or supply. None blocks starting the build; each blocks launch.

## Needed before the build can be configured

1. **Prices — mostly answered, one to confirm.** Read out of live Acuity bookings on the
   calendars: Snooker **£7.50/hour** (three data points, all consistent), Lounge **£10.00/hour**,
   Studio **£10.00/hour**. The Studio rests on a single 4h = £40.00 booking and gives a 75 m²
   hall the same rate as the small Lounge — plausible, but check it against the Acuity config
   before launch. Also still unknown: whether any peak, weekend or off-peak rate exists.
2. **Opening hours per room, per weekday.** Including whether the Snooker Room's hours depend
   on the bar being open — the facility copy mentions "drinks available from the bar downstairs
   when open", which implies a coupling worth being explicit about.
3. **Minimum and maximum booking length per room.** Is a 30-minute snooker booking allowed? Can
   the Studio be taken for a whole day?
4. **Buffer between bookings.** Does the Studio need turnaround time between hirers?
5. **Minimum notice and maximum advance.** Can someone book the Lounge for this evening? Can
   they book next August?

## Needed before launch

6. **Terms of hire — and there is a live problem here.** Every Acuity booking makes the hirer
   tick *"Tick to agree to the room hire terms and conditions? https://meadowbrookdartington.org/room-hire-terms"*.
   **That URL currently returns 404.** Hirers have been agreeing to terms that cannot be read,
   which is worth fixing regardless of this project — a consent checkbox pointing at a dead page
   is not much of a consent. The link is also referenced from the stale `src/content/pages/large-room.md`,
   which predates the Keystatic migration and is not what the site serves.
   Needed: the actual wording (cancellation, room rules, liability, damage), published at
   `/room-hire-terms`, before the new booking form reuses the same consent line.
7. **Privacy policy update.** Booking data: what is stored, where, for how long, shared with
   whom. The policy is a Google Doc, so this is an edit outside the repo.
8. **Which address receives owner notifications and system alerts** (`06`).
9. **Which Workspace accounts get `/admin` access** — the `BOOKING_ADMIN_EMAILS` allowlist (`07`).
10. **Acuity's calendar-sync behaviour on disconnection** — the test described in `09`. This one
    has teeth: get it wrong and paid-for bookings vanish from the calendars.

## Decisions worth revisiting

11. **The full-refund-until-start policy (D4).** As built, a hirer can hold a Saturday evening
    Studio slot and release it an hour before at no cost, and the DRA has no time to re-let it.
    Every comparable venue has a cancellation window for exactly this reason. The code is
    written so `CANCELLATION_WINDOW_HOURS = 48` is a config change and nothing more — the
    decision can be reversed cheaply, but somebody should make it deliberately rather than
    discover it in a bad month.

12. **Recurring bookings.** Out of scope for v1 (`00`), and the Studio copy already advertises
    "hourly or recurring hire". Regular hirers are probably the most valuable customers and are
    currently handled by hand. The reporting page includes a repeat-booker breakdown (`07`)
    specifically so this decision gets made with a number attached to it.

13. **The stray `calendartopasscode` project.** The raffle POC's service account lives there,
    unrelated to anything else. Worth folding into a proper project or deleting once the raffle
    is done — not part of this work, but noted while we were in the neighbourhood.

14. **VAT.** If the DRA is or becomes VAT-registered, room hire pricing and receipts need to say
    so. Currently assumed out of scope; confirm.
