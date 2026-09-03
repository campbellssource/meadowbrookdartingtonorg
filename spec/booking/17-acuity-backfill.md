# 17 — Back-filling history from Acuity

Requested by the DRA on 3 Sep 2026. The reporting page (`07`) can only see bookings
this system took, so on day one it shows a fortnight of history and the occupancy
chart has nothing to compare against. Acuity holds years of it.

Not built. This is the design, and the hazards are the point of writing it down.

## What the export actually contains

The DRA supplied `private/acuity-bookings.csv` on 3 Sep 2026 (gitignored — see
`private/README.md`). Read rather than assumed, because three of the open questions
below were answered by looking:

| | |
|---|---|
| Rows | 879 |
| Range | 6 Oct 2024 → 26 Sep 2026 |
| Past / future | 877 / 2 |
| Columns | 19, including `Appointment ID`, `Calendar`, `Type`, `Start Time`, `End Time`, `Appointment Price`, `Amount Paid Online`, `Paid?`, `Date Scheduled`, `Date Rescheduled` |

**`Appointment ID` is unique across all 879 rows**, so `ACU-<id>` is a safe document
id and the import is idempotent as designed.

**17 rows are not room bookings at all** — 15 donations (`£10 Donation`, `£5
Suggested family donation`) and 2 event entries (`Extravaganza entry`, `Soul Sauna
Sisterhood Ceremony`). Every one of them has an **empty `Calendar`**, and every
genuine room booking has one, so `Calendar` is a clean filter. Importing the
donations as bookings would put £0-duration rows into occupancy and money into
room revenue that no room earned. **862 rows are real bookings.**

`Calendar` maps directly onto our rooms, with no ambiguity:

| Acuity `Calendar` | Room | Rows |
|---|---|---|
| `Snooker room` | `snooker-room` | 730 |
| `Studio - Large room` | `large-room` | 104 |
| `Lounge - Small room` | `small-room` | 28 |

**Times are local wall times** (`October 6, 2024 13:00`) with `Timezone` set to
`Europe/London` on every row. They must be resolved in London, not parsed as UTC —
the same trap as all-day calendar events, and here it would shift a year of bookings
by an hour across every BST period.

**`Appointment Price` and `Amount Paid Online` differ**, and the difference is
meaningful: rows priced £10.00 with £0.00 paid online are bookings settled in person
or never collected. **39 rows are `Paid? = no`**, mostly Large room. Store the price
as `pricePence` and the online amount as `paidPence`, so "what the rooms were worth"
and "what actually came through the payment provider" stay separable — they are
different questions and the treasurer asks both.

**There is no cancellation column.** The export appears to hold live appointments
only, so historical revenue will not be overstated by cancellations — but a
cancellation *rate* cannot be computed for the Acuity period, and the reporting page
should not imply one. `Date Rescheduled` is set on 51 rows.

**Gaps:** 31 rows have no email and 121 no phone. Neither matters for reporting —
and since nothing is written to a calendar, no door code depends on them.

## What is being imported, and what is not

**Imported:** the booking record — room, start, end, duration, price, booker name and
email, and when it was made. Enough for revenue, occupancy, lead time and repeat-booker
analysis, which is the whole reason for doing it.

**Not imported, deliberately:**

| | Why not |
|---|---|
| **Calendar events** | They are already there. Acuity wrote them years ago and the door-lock system (`13`) watched them at the time. Re-creating them would duplicate every historical booking on the room calendars — and creating a calendar event is not inert: it is what provisions a door code. A bulk import that wrote events would attempt thousands of TTLock passcodes. |
| **Emails** | Nobody should receive a confirmation for a booking they attended in 2024. |
| **Magic-link tokens** | There is nothing to manage. |
| **Square payment ids** | The money moved through Acuity, not our Square account. A ledger entry with a `squarePaymentId` we do not own would make reconciliation (`04`) chase payments that were never ours. |

## The flag, and why it has to exist

Every imported booking carries `source: 'acuity'`. Bookings this system takes carry
`source: 'meadowbrook'`, backfilled onto existing records as part of the migration so
the field is never absent.

This is not decoration. It is the guard that stops the rest of the system treating a
historical record as a live one:

- **The manage page and the amend/cancel APIs must refuse `source: 'acuity'` outright.**
  There is no calendar event we own to move, and no payment of ours to refund. Without
  the guard, `cancel` would attempt a refund against a `squarePaymentId` that is not in
  our Square account, and `amend` would try to patch a calendar event it did not create.
- **Reconciliation must skip them**, or every historical booking becomes a permanent
  `needsReview` entry for a payment Square has never heard of.
- **The reminder job must skip them**, though the date filter would catch that anyway.
- **Reporting shows them**, which is the entire purpose — but the admin list should
  mark them, and the reporting page should be able to exclude them so "how are we doing
  since we took over our own bookings" is answerable.
- **`/bookings/find` must not offer them.** It emails a magic link for any upcoming
  booking matching an address, and two imported bookings are still in the future.
  A link would open a manage page whose every button refuses.
- **The reminder job must skip them.** Acuity sent its own reminders at the time, and
  these people never gave us their address for this system to email from.

## References

Acuity's own appointment id, prefixed: `ACU-<id>`. Two reasons over minting `MB-`
references. It keeps the two systems' records visibly distinct at a glance, and it
makes the import **idempotent** — the document id is derived from the source row, so
re-running the import updates rather than duplicates. A backfill that cannot be safely
re-run is a backfill nobody dares to re-run.

## Money

**Corrected 3 Sep 2026, while building the importer.** This section previously said to
store an **empty `payments` array** and let `pricePence` carry the revenue. That is
wrong, and checking `reporting.ts` rather than trusting the plan is what caught it:

```ts
const completed = (b, kind) =>
  b.payments.filter((p) => p.kind === kind && p.status === 'completed')
    .reduce((s, p) => s + p.amountPence, 0);
```

Revenue, net revenue, average booking value and revenue-by-room-by-month all sum the
**ledger**, not `pricePence`. An imported booking with no payments would have reported
£0 — every chart flat, the entire backfill pointless, and nothing anywhere would have
errored to say so.

So each imported booking carries **one synthetic completed charge** for the
appointment price, with an **empty `squarePaymentId`**. That is the detail that keeps
it safe: `reconcile.ts` only inspects entries that have a payment id, so it never
chases a payment that was never in our Square account, and it only acts on `pending`
entries, so a `completed` one is inert.

`Appointment Price` and `Amount Paid Online` differ on 39 rows. **The DRA's decision
(3 Sep 2026): include them at full price** — the rooms were used and the income
question is not worth the complication. What Acuity actually collected online is kept
on `acuity.paidOnlinePence` alongside `acuity.paid`, so the distinction is recoverable
without complicating reporting.

Cancelled and refunded historical bookings need thought: if the export distinguishes
them, carry the status across, because counting a refunded 2024 booking as revenue
overstates every total that includes it.

## Data protection

This imports personal data — names and email addresses of people who booked years
ago — into a new system. It does not need new consent (it is the same charity, the
same purpose, and the lawful basis in `12` is contract and legal obligation), but:

- The 7-year retention in `12` applies from the **booking date**, not the import date.
  Anything already older than that should not be imported at all.
- Phone numbers are worth omitting unless reporting needs them, which it does not.
  Less imported personal data is strictly better here.
- `12` already lists Acuity as a processor while it is in use. That stays true.

## Open questions

1. ~~**How far back?**~~ Moot — the export starts 6 Oct 2024, comfortably inside the
   7-year horizon, so all of it can be imported.
2. **Export or API?** A CSV export is a one-off and simple; the API allows a repeatable
   import while both systems run in parallel (`09`). The parallel-running period is
   real, so the API may be worth it.
3. ~~Does the export distinguish **cancelled** bookings?~~ It contains none, so totals
   are not inflated by them. Still open: should the **39 unpaid** rows count as
   revenue? They occupied a room, so they belong in occupancy; `paidPence: 0` keeps
   them out of income, which is the honest treatment.
4. Should the occupancy chart draw a **line at the changeover date**? The two periods
   are not measured identically — Acuity's rules were not ours — and a chart that hides
   that invites the wrong conclusion.

## Acceptance criteria

- [ ] No calendar event is created, patched or deleted by the import, on any calendar.
- [ ] No email is sent by the import.
- [ ] Running the import twice produces the same records, not duplicates.
- [ ] `source` is present on every booking, imported or not.
- [ ] Amend and cancel refuse an `acuity` booking with a clear message.
- [ ] Reconciliation ignores `acuity` bookings and never flags them for review.
- [ ] Reporting can show totals with and without imported history.
- [ ] Nothing older than the retention horizon is imported.
- [ ] Rows with an empty `Calendar` (donations and event entries) are excluded.
- [ ] Times are resolved in Europe/London, verified against a booking either side of
      a BST boundary.
- [ ] The 2 future-dated bookings do not create a second record for a slot the room
      calendar already shows as busy.
