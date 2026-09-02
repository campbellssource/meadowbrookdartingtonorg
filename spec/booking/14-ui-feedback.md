# 14 — UI feedback and polish

## Where this fits

`IMPLEMENTATION-PLAN.md` Phase 6 covers accessibility, no-JS and security hardening. It did
**not** cover visual and interaction polish, which is a different job with a different reviewer —
the DRA, not a test suite. This file is that job.

**The booking UI as built is deliberately not finished.** It exists to prove the flow works end
to end: pick a slot, pay, get confirmed. It reuses the site's design tokens so it is not ugly,
but it has had no design pass, and the three-step wizard is the first shape that fitted rather
than the best one.

## How to feed feedback in

Add it to the list below, in whatever form is easiest — a sentence, a screenshot description, "I
don't like X". No need to specify a fix. Batched deliberately rather than fixed one at a time,
because UI notes contradict each other and a batch can be reconciled where a stream cannot.

Anything that is a **bug** (something broken, wrong or misleading) jumps the queue and is fixed
immediately rather than collected here.

## Where the form should live

The DRA wants the booking form **embedded in each facility page**, not on a separate
`/book/[slug]` route (note 4). That is roughly where Acuity's widget sits today, so it matches
what hirers are used to, and it removes a navigation step.

Worth planning rather than retrofitting: it means the form becomes a component that a facility
page drops in, which is how `03` always described it (`BookingWidget.astro`). The standalone
page can stay as a direct link for people who arrive from an email.

## Outstanding

| # | Note | Raised | Status |
|---|---|---|---|
| 1 | Door-code explanation was on the phone field at step 2; belongs only on the confirmation | 1 Sep 2026 | **Done** — moved to confirmation |
| 2 | `/bookings/:ref` should show the booker's name | 2 Sep 2026 | **Done** — "Booked for" row plus a first-name greeting |
| 3 | Clicking Pay without ticking the terms box gives no feedback at all | 2 Sep 2026 | **Done** — the disabled state now explains itself. Kept on the list: the wider pattern (disabled buttons that say nothing) needs a once-over across the flow |
| 4 | Embed the booking form in each facility page rather than a separate `/book/[slug]` page | 2 Sep 2026 | **Open** — for the Phase 5b pass |

## Known rough edges, unprompted

Things already visible without anyone needing to report them:

- **Three-step wizard.** Committed to early. A single scrolling page may well be better for a
  booking this simple — there is no branching and only six fields.
- **No loading states** beyond the word "Loading…" on slots, and no skeleton while availability
  fetches. A slow calendar read looks like a broken page.
- **The date picker is a bare `<input type="date">`.** It gives no sense of which days have
  availability, so finding a free Saturday means guessing one date at a time. The availability
  endpoint already returns a range, so a small month view showing which days have slots is
  mostly a rendering job.
- **Errors appear at the bottom** of the panel and are scrolled to. Fine, but a field-level error
  next to the offending input would be better for the name/email/phone cases.
- **No back navigation** between steps once past step 1 — you can change the date, but there is
  no way back from payment to details without a reload.
- **Mobile has had no real attention.** It should stack, but it has not been driven on a phone.
- **The confirmation page is a dead end.** No add-to-calendar button and no "book another".
- **Disabled buttons that explain nothing.** Fixed for the terms checkbox (note 3), but the
  pattern recurs: the amend confirm button and the pay button both spend time disabled with no
  visible reason. Worth one pass across the flow rather than three separate fixes.

## Acceptance criteria

- [ ] Every note in the table is either done or explicitly declined with a reason.
- [ ] The flow has been driven on a real phone, not just a narrow window.
- [ ] Phase 6's accessibility pass happens *after* this, so it audits the final shape.
