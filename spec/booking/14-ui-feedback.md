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

## The reveal pattern

The DRA's rule, and it applies to the whole flow: **anything that appears in response to a press
gets scrolled to.** Otherwise the page changes below the fold and reads as though the button did
nothing — which is the same complaint as the disabled Pay button, in a different disguise.

Three cases, deliberately different, because "scroll to the new thing" means different things
depending on what changed:

| What happened | Where it scrolls | Why |
|---|---|---|
| A booking-form **step** (steps replace each other) | Top of the whole widget | Each step should read as its own page: "Book the Studio", then the step you are on |
| A manage-page **panel** opens (it expands, nothing is replaced) | Top of that panel | Its heading becomes the first thing read, with the booking it refers to still above |
| Something appears **inside** either | Only if genuinely off screen | Picking a time should not throw the page around when the durations are already visible beneath it |

A fourth case sits outside the table: **arriving at a confirmation**. Amending or cancelling
reloads the page, and browsers restore scroll position across a reload — so you would land
halfway down the page you were already on rather than at the confirmation of what just happened.
A `sessionStorage` flag is set immediately before the reload and cleared on arrival, so those
two land at the top while an ordinary mid-read refresh still keeps its place.

All three wait a frame so the element is laid out before measuring, and honour
`prefers-reduced-motion`. Targets carry `scroll-margin-top: 96px` because the site nav is sticky
and `block: 'start'` would otherwise land them underneath it.

## Three CSS traps this flow hit, all silent

Worth knowing before building anything else on this site. None produced an error.

**1. Scoped styles do not reach runtime-created elements.** Astro scopes CSS by adding
`data-astro-cid-*` to elements *in the template*. Anything built with `innerHTML` never gets it,
so `.bw-day { … }` compiles to `.bw-day[data-astro-cid-x]` and matches nothing. The calendar,
time and duration chips were unstyled for days without anyone noticing, which is why a selected
day looked the same as an unselected one. Fix: anchor to a container that is in the template and
mark the child `:global()`. `test/astro-script-placement.test.ts` now fails the build on it.

**2. `.mw-btn` sets `display`, which beats `[hidden]`.** The browser's `[hidden] { display: none }`
is a low-specificity UA rule; a class selector that sets `display` overrides it. So `el.hidden =
true` on any `.mw-btn` does nothing — which is how a second, dead "Continue" survived onto the
payment step. Any component that toggles a button with `hidden` needs
`[hidden] { display: none !important }` of its own.

**3. Headings inherit the zone's display face.** `global.css` sets
`font-family: var(--font-display)` on `h1`, `h2` and `h3`, and each zone swaps that for its own
face — Billiard on the Snooker Room. Those faces are for large display text; a form heading in
one reads as decoration where it should read as a label. Functional components should set
`font-family: var(--font-body)` on their headings rather than inherit.

**4. `.mw-btn-primary` inherits the zone accent.** It is `background: var(--accent, var(--green))`,
and `zone-snooker` sets `--accent: var(--bone)`. On a white card that is white on white until
hover. Inside the booking widget the primary action is pinned to green regardless of the room.

## Zone themes — the thing to check before styling anything

The facility pages carry a `zone-*` class that repaints the page: `zone-snooker` sets
`--bg: #004D26`, `--fg: var(--bone)` and `--accent: var(--bone)`. A light card that does not
state its own colours therefore inherits **white text onto a white card**, which is what the DRA
saw. `global.css` already handles this in `.mw-card` by setting `color: var(--ink)` explicitly
on its text children; the booking widget now does the same.

Worth knowing for anything built on a facility page: `--fg` and `--accent` are not safe to
inherit there, and `.mw-eyebrow` in particular resolves to `--accent`, which is white in half
the zones.

## Decided and not built: a text input for duration

The DRA asked, with a question mark, whether duration should also accept typed input. Not
built, on the grounds that the set is small and constrained — 30-minute steps from one hour,
bounded by what is actually free after the buffer — so a text field can only ever produce
values that have to be rejected. The chips show six lengths with the rest one click away, which
covers the same ground without a validation message. Easy to add if a hirer ever asks for it.

## Deferred by the DRA: a URL per step

Their preference is a URL for each step of the form, so the back button behaves. Deliberately
not done yet. Worth revisiting: the back button currently leaves the wizard entirely, which is
the thing that preference exists to prevent.

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
| 4 | Embed the booking form in each facility page rather than a separate `/book/[slug]` page | 2 Sep 2026 | **Done** — `BookingWidget.astro`, replacing the Acuity iframe on all three |
| 5 | Too small and fiddly; can take up more of the page | 2 Sep 2026 | **Done** — full-width widget, larger targets |
| 6 | Always-visible calendar rather than a date picker you open (same reason radio beats a dropdown) | 2 Sep 2026 | **Done** — month grid, days marked by availability |
| 7 | Unclear what you have selected | 2 Sep 2026 | **Done** — persistent summary bar with date, time, length and price |
| 8 | Start times beside the calendar, then duration; default 1 hour, more on request | 2 Sep 2026 | **Done** — six lengths shown, "show longer" for the rest |
| 9 | Amending should default to the previous duration | 2 Sep 2026 | **Done** — preselected and marked "current", quoted immediately |
| 10 | Text the same colour as the background on the Snooker Room page | 2 Sep 2026 | **Done** — the widget now sets its own ink colours; zone themes flip `--fg` to white |
| 11 | Calendar need not mark free/busy days — not worth the slower load | 2 Sep 2026 | **Done** — marking and its extra request removed |
| 12 | Show unavailable time slots greyed out and struck through | 2 Sep 2026 | **Done** — the whole day is drawn, taken slots stay in place |
| 13 | Selected day and time need a much stronger state | 2 Sep 2026 | **Done** — filled dark green, bold, ringed |
| 14 | Don't default the duration to one hour after all | 2 Sep 2026 | **Done** — no default; the summary appears only once a length is chosen |
| 15 | Selected state still looked identical | 2 Sep 2026 | **Done** — the rules were never applying; see below |
| 16 | Continue button white on white on the Snooker page | 2 Sep 2026 | **Done** — `.mw-btn-primary` is `var(--accent)`, which zones set to bone |
| 17 | Form labels and help text too small | 2 Sep 2026 | **Done** — labels 15px, help and notes 14px, terms 16px |
| 18 | Two Continue buttons at the payment step, one dead | 2 Sep 2026 | **Done** — `.mw-btn` sets `display`, which beat `[hidden]` |
| 19 | Sub-brand display font on the booking form — those faces are for large display text only | 2 Sep 2026 | **Done** — widget headings use the body font |
| 20 | "Reserve this space" should be "Book the Snooker Room" | 2 Sep 2026 | **Done** — heading names the room |
| 21 | After cancelling you land on "We need your booking link" | 2 Sep 2026 | **Done** — the page now confirms the cancellation and offers to rebook |
| 22 | Pressing Pay without accepting the terms gives no feedback | 2 Sep 2026 | **Done** — validate on press, red outline on the offending field, reason above the button |
| 23 | Revealed UI should be scrolled to, not hunted for — a general pattern | 2 Sep 2026 | **Done** — `reveal()` in both the widget and the manage page |
| 24 | A confirmation should always start at the top of the page | 2 Sep 2026 | **Done** — amend and cancel reloads land at the top |
| 25 | Square's card field doesn't look like a card input; people don't notice it | 2 Sep 2026 | **Done** — `includeInputLabels` plus site styling, both supported API |
| 26 | The postal-code hint stays after entering a value | 2 Sep 2026 | **Done** — a sandbox artefact (US ZIP validation); prefilled in sandbox, unchanged in production |

## Known rough edges, unprompted

Things already visible without anyone needing to report them:

- **Three-step wizard, kept.** The DRA likes the flow (time → details → pay); it is the first
  step that has been rebuilt rather than the shape.
- **No loading states** beyond the word "Loading…". A slow calendar read still looks like a
  broken page.
- ~~**Errors appear at the bottom** of the panel.~~ **Resolved by note 22** — name, email, phone
  and the intake question all mark themselves and focus.
- **No back navigation** between steps once past step 1 — you can change the date, but there is
  no way back from payment to details without a reload.
- **Mobile has had no real attention.** It should stack, but it has not been driven on a phone.
- **The confirmation page is a dead end.** No add-to-calendar button and no "book another".
- ~~**Disabled buttons that explain nothing.**~~ **Resolved by note 22.** The DRA's preferred
  pattern, now used throughout the booking form: the button is never disabled for a validation
  reason, pressing it marks the offending field with a red outline, and the reason appears
  immediately above the button. A disabled button cannot say why it is disabled — you press it,
  nothing happens, and there is nowhere to look.

## Acceptance criteria

- [ ] Every note in the table is either done or explicitly declined with a reason.
- [ ] The flow has been driven on a real phone, not just a narrow window.
- [ ] Phase 6's accessibility pass happens *after* this, so it audits the final shape.
