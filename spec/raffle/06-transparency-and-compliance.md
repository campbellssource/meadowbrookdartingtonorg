# 06 — Transparency & Compliance

Two separate things: making the draw *feel* fair, and making the raffle *legally* fine. Both matter.

## Transparency (the trust story)

The team's worry is that a digital draw won't feel authentic. Build for that:

1. **Public entries list** (`/entries`) — anyone can see their ticket is in the pool before the
   draw. This is the digital "watching your slip go into the drum".
2. **Cryptographic randomness** — `crypto.randomInt`, stated openly. Not a black box, not
   `Math.random`.
3. **Pool size shown at draw time** — "drawn from 214 entries" on screen when the winner appears.
4. **Draw record** — every draw stores what method was used, how big the pool was, who ran it,
   and when. Inspectable after the fact.
5. **Live, in person** — the draw happens on stage as part of the day, run by a committee
   member, with the rule (e.g. "one prize per person") announced before any draw.
6. Optional but strong: **publish the draw code** or a plain-English description on the site so
   anyone technical can check it's genuinely random.

Together these remove the "some website just took my money" feeling.

## Compliance — READ THIS, DO NOT SKIP

**Not legal advice — verify before running anything for real.** Running a lottery/raffle in
the UK is regulated by the Gambling Commission, and *going digital may change which category
you fall into*.

The likely tension:

- An **incidental lottery** (the usual "raffle at the summer fête" category) has conditions
  about tickets being sold and the draw happening at the event itself. Selling entries online —
  especially before the day, or to people not physically at the event — can push you **out** of
  that category.
- A **small society lottery** allows broader/online selling but must be **registered with the
  local licensing authority** (the council), with rules on ticket info, proceeds to the cause,
  returns, and record-keeping.

Before the event, the DRA committee should confirm, from current Gambling Commission guidance:

- [ ] Which category this raffle falls under **given online, possibly-advance sales**.
- [ ] Whether registration with the local authority is required, and the lead time for it.
- [ ] Ticket/entry information requirements (price, promoter, draw date, cause).
- [ ] Any limits on total sales / prize values / expenses.
- [ ] Record-keeping and post-event return obligations.

This is a governance item for DRA as a charity, not a coding task — but the *design* (advance
online sales vs sales only at the event) is a compliance decision, so settle it **before**
finalising the QR/entry timing. It's worth a quick call or check against the Gambling
Commission's own guidance rather than relying on memory or this document.

## Acceptance criteria

- [ ] `/entries` is public and complete.
- [ ] Draw method + pool size are recorded and displayable.
- [ ] The compliance checklist above has been reviewed by the committee before any real sale.
