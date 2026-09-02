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

## Outstanding

| # | Note | Raised | Status |
|---|---|---|---|
| 1 | Door-code explanation was on the phone field at step 2; belongs only on the confirmation | 1 Sep 2026 | **Done** — moved to confirmation |
| 2 | `/bookings/:ref` should show the booker's name | 2 Sep 2026 | **Done** — "Booked for" row plus a first-name greeting |

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
- **The confirmation page is a dead end.** No add-to-calendar button, no "book another", and the
  manage link does not exist until Phase 3.

## Acceptance criteria

- [ ] Every note in the table is either done or explicitly declined with a reason.
- [ ] The flow has been driven on a real phone, not just a narrow window.
- [ ] Phase 6's accessibility pass happens *after* this, so it audits the final shape.
