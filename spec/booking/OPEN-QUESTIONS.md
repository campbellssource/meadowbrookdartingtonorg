# Open questions

Things the DRA must decide or supply. Struck-through items are settled; kept for the reasoning.

**Genuinely open, as of 31 Aug 2026:**

| # | Question | Blocks |
|---|---|---|
| 20 | Is the 30-min buffer per-room or across Studio/Lounge? | **Phase 1 code** — the only one that does |
| 22 | How far ahead can someone book? | Phase 1 config |
| 17 | Insurance check on hire terms clauses 9–11 | **Launch** |
| 19 | `bookings@` exists, monitored, Brevo-verified | **Launch** |
| 6 | Hire terms approved and published | **Launch** |
| 23 | Which calendars are wired to the locks and scrubber | Confirmation email wording |
| 14 | VAT | Launch, if applicable |
| 7 | Privacy policy | DRA has deferred to post-go-live |
| 12 | Recurring bookings | Deferred by design |

## Needed before the build can be configured

1. ~~**Prices.**~~ **ANSWERED 31 Aug 2026.** Snooker £7.50/hour, Studio £10.00/hour, Lounge
   £10.00/hour — the Studio's single-data-point reading confirmed correct. No peak, weekend or
   off-peak rate. Recorded in `02-availability-and-rules.md`.
2. ~~**Opening hours.**~~ **ANSWERED 31 Aug 2026.** 08:00–23:00, every day, all three rooms. No
   weekday variation and no coupling to the bar's hours.
3. ~~**Booking length.**~~ **ANSWERED 31 Aug 2026.** Minimum 1 hour everywhere, in 30-minute
   steps; maximum is a single day and no booking may span midnight.
4. ~~**Buffer.**~~ **ANSWERED 31 Aug 2026** — but see question 20, which is the one word of it
   that is ambiguous.
5. ~~**Minimum notice.**~~ **ANSWERED 31 Aug 2026.** None, other than that a booking cannot start
   in the quarter-hour already in progress. Maximum advance still unstated — `maxAdvanceDays`
   defaults to 180; say if that is wrong.

## Needed before launch

6. **Terms of hire — and there is a live problem here.** Every Acuity booking makes the hirer
   tick *"Tick to agree to the room hire terms and conditions? https://meadowbrookdartington.org/room-hire-terms"*.
   **That URL currently returns 404.** Hirers have been agreeing to terms that cannot be read,
   which is worth fixing regardless of this project — a consent checkbox pointing at a dead page
   is not much of a consent. The link is also referenced from the stale `src/content/pages/large-room.md`,
   which predates the Keystatic migration and is not what the site serves.
   **Drafted 31 Aug 2026 in `10-terms.md`** — needs DRA approval, the insurance check (17), and
   publishing at `/room-hire-terms`. Until it is published this remains live on the *current*
   Acuity form, not just the new one. A branded 404 now catches the dead link, which is a better
   dead end, but still a dead end.
7. **Privacy policy update — drafted; DRA has deferred it to after go-live.** Full text ready to
   apply in `12`. Noting for the record what is being carried until then, since the decision was
   made knowing it: the policy names Stripe as the payment processor (it is Square) and
   Squarespace as the host (it is Cloud Run), states a 90-day calendar retention that at least
   two of the three calendars do not currently meet, and does not mention door passcodes at all.
   None of it is new — all of it predates this project. Apply `12` when the DRA is ready.
8. ~~**Owner notification address.**~~ **ANSWERED 31 Aug 2026.** Bookings to `bookings@`, gated
   by `BOOKING_NOTIFY_OWNER` so it can be switched off later; failures and alerts to `it@`,
   permanently and ungated.
9. ~~**`/admin` access.**~~ **ANSWERED 31 Aug 2026.** `michael.campbell@meadowbrookdartington.org`.
10. ~~**Acuity disconnection risk.**~~ **DOWNGRADED 31 Aug 2026.** The DRA will run both systems
    in parallel rather than cutting over, so this stops being a launch blocker. It becomes a
    question for whenever Acuity is actually switched off — still worth testing then, because
    the failure mode (paid bookings vanishing from the calendars) is unchanged. See `09`.

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

13. ~~**The stray `calendartopasscode` project.**~~ **CORRECTED 31 Aug 2026 — it is not stray.**
    It runs the building's door-passcode system off these calendars (`13`). Do not tidy it away.
    The raffle POC's service account does also live there, which is worth separating one day,
    but the project itself is load-bearing.

14. **VAT.** If the DRA is or becomes VAT-registered, room hire pricing and receipts need to say
    so. Currently assumed out of scope; confirm.

## Added 31 Aug 2026

17. **Insurance check on the hire terms — launch blocker.** `10-terms.md` drafts the room hire
    terms. The cancellation, pricing and conduct clauses are the DRA's own call and are settled.
    Clauses 9, 10 and 11 — responsibility for your group, under-18s and safeguarding, and
    insurance and liability — are drafted to be sensible for a community centre but must be read
    against the DRA's actual insurance policy before the page is published. This is the one part
    of the build where being approximately right is worse than being late.

18. ~~**Minimum notice for the Studio and Lounge.**~~ **ANSWERED 31 Aug 2026.** Zero, the same as
    Snooker. All three rooms are bookable up to the next quarter-hour.

19. **The `bookings@meadowbrookdartington.org` address.** `10-terms.md` and every transactional
    email point at it. It needs to exist, be monitored by someone, and be verified as a Brevo
    sender with SPF and DKIM.

## Added 31 Aug 2026, second pass

20. **Is the 30-minute buffer per-room or between the Studio and the Lounge?** Built as
    per-room: 30 minutes either side of a Studio booking, 30 either side of a Lounge booking,
    neither affecting the other. The alternative reading — a Studio booking also holding the
    Lounge clear — is credible, because the rooms adjoin and the Lounge lends the Studio
    furniture. The two produce visibly different availability, and the wrong one will look
    correct right up until two hirers arrive at once. One sentence settles it.

21. ~~**The 90-day calendar purge needs code.**~~ **CORRECTED 31 Aug 2026.** A scrubber already
    exists, in the `calendartopasscode` project, and it works — see `13`. The booking system
    should **not** build a competing one. What remains is coverage (question 23) and a one-off
    tidy-up of the pre-tool backlog.

22. **Maximum advance booking.** `maxAdvanceDays: 180` is still a guess. How far ahead should
    someone be able to book the Studio?

23. **Which calendars are wired to the locks and the contact scrubber?** Both
    `calendartopasscode` functions name a single calendar — the Lounge. Nine Studio and Snooker
    bookings that ended over a week ago still carry full names and mobile numbers, which points
    the same way. If it holds, two consequences: the Snooker Room is carrying the most personal
    data with the least scrubbing, and Studio and Snooker hirers are getting into the building
    some way other than an automatic passcode — which the new system's confirmation emails must
    not contradict. Evidence in `13`.
