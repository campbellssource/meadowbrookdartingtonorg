# Open questions

Things the DRA must decide or supply. None blocks starting the build; each blocks launch.

## Needed before the build can be configured

1. ~~**Prices.**~~ **ANSWERED 31 Aug 2026.** Snooker £7.50/hour, Studio £10.00/hour, Lounge
   £10.00/hour — the Studio's single-data-point reading confirmed correct. No peak, weekend or
   off-peak rate. Recorded in `02-availability-and-rules.md`.
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

11. ~~**The full-refund-until-start policy.**~~ **ANSWERED 31 Aug 2026:** cancel up to 1 hour
    before the start for a full refund; nothing inside the hour. `CANCELLATION_WINDOW_HOURS = 1`.
    One residual item, and it is a disclosure question rather than a policy one: because Snooker
    has `minNoticeHours: 0`, a snooker booking made inside the hour is non-refundable
    immediately. The build warns at checkout (`04`). Worth the DRA knowing that this case exists
    and is intended, because it is the one a hirer is most likely to complain about.

12. **Recurring bookings.** Out of scope for v1 (`00`), and the Studio copy already advertises
    "hourly or recurring hire". Regular hirers are probably the most valuable customers and are
    currently handled by hand. The reporting page includes a repeat-booker breakdown (`07`)
    specifically so this decision gets made with a number attached to it.

13. **The stray `calendartopasscode` project.** The raffle POC's service account lives there,
    unrelated to anything else. Worth folding into a proper project or deleting once the raffle
    is done — not part of this work, but noted while we were in the neighbourhood.

14. **VAT.** If the DRA is or becomes VAT-registered, room hire pricing and receipts need to say
    so. Currently assumed out of scope; confirm.

## Added 31 Aug 2026

17. **Insurance check on the hire terms — launch blocker.** `10-terms.md` drafts the room hire
    terms. The cancellation, pricing and conduct clauses are the DRA's own call and are settled.
    Clauses 9, 10 and 11 — responsibility for your group, under-18s and safeguarding, and
    insurance and liability — are drafted to be sensible for a community centre but must be read
    against the DRA's actual insurance policy before the page is published. This is the one part
    of the build where being approximately right is worse than being late.

18. **Minimum notice for the Studio and Lounge.** Snooker is settled at `0` (last-minute by
    design). The other two default to 24 hours, which is a guess — it depends on whether hirers
    need a key, a code or someone to let them in. If the rooms are self-access, 24 hours is
    needlessly restrictive and will lose bookings.

19. **The `bookings@meadowbrookdartington.org` address.** `10-terms.md` and every transactional
    email point at it. It needs to exist, be monitored by someone, and be verified as a Brevo
    sender with SPF and DKIM.
