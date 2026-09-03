# 17 — Back-filling history from Acuity

Requested by the DRA on 3 Sep 2026. The reporting page (`07`) can only see bookings
this system took, so on day one it shows a fortnight of history and the occupancy
chart has nothing to compare against. Acuity holds years of it.

Not built. This is the design, and the hazards are the point of writing it down.

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
| **Payment ledger entries with Square ids** | The money moved through Acuity, not through our Square account. A ledger entry with a `squarePaymentId` we do not own would make reconciliation (`04`) chase payments that were never ours. |

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

## References

Acuity's own appointment id, prefixed: `ACU-<id>`. Two reasons over minting `MB-`
references. It keeps the two systems' records visibly distinct at a glance, and it
makes the import **idempotent** — the document id is derived from the source row, so
re-running the import updates rather than duplicates. A backfill that cannot be safely
re-run is a backfill nobody dares to re-run.

## Money

Acuity's export carries what was charged. Store it as `pricePence` and `paidPence`
with an **empty `payments` array**, and let `source: 'acuity'` explain the absence
rather than inventing ledger entries to fill it. Reporting sums `pricePence` for
revenue, so the numbers work; reconciliation skips them, so the empty ledger is never
read as drift.

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

1. **How far back?** Everything Acuity holds, or the last N years? The 7-year retention
   horizon is a natural stop, and so is "since the current pricing came in".
2. **Export or API?** A CSV export is a one-off and simple; the API allows a repeatable
   import while both systems run in parallel (`09`). The parallel-running period is
   real, so the API may be worth it.
3. Does the Acuity export distinguish **cancelled and refunded** bookings? If not,
   revenue totals will be optimistic and should be labelled as such.
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
