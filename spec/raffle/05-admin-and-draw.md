# 05 — Admin Dashboard & Draw

The bit that runs on the day. One admin, pressing one button per prize.

## Access (POC only)

- Guard `/admin/*` with a shared secret: a header/cookie compared against `ADMIN_SECRET`, or
  HTTP basic auth. This is **POC-grade only** — good enough for one trusted operator, not for
  production. Note it in the code.

## Dashboard

`GET /admin`

- Live totals: entries, distinct entrants, total pennies raised.
- List of prizes, each showing: name, donor, draw status (Not drawn / Won by `MB-0042` — Name).
- A **Draw** button per prize that has not yet been drawn.
- Once drawn, show the winner (ticket number + name + contact details, since admin needs to
  reach them) and the pool size at draw time.

## Draw logic

`POST /api/admin/draw` with `{ prizeId }`.

1. Reject if this prize already has a `draws` row (no accidental redraw). A deliberate redraw
   is a separate, explicit action — out of scope for the POC, or gated behind a confirm + reason.
2. Build the **eligible pool**:
   - All `entries`, **excluding** any entry whose entrant has already won a prize, **if**
     `EXCLUDE_PREVIOUS_WINNERS=true` (default). This stops one person sweeping every prize.
   - If `false`, the pool is all entries and a person can win more than once.
3. If the pool is empty, return a clear "no eligible entries" error and draw nothing.
4. Select the winner with **`crypto.randomInt(0, pool.length)`** — not `Math.random`. This is
   uniform and cryptographically sound, which matters for the fairness/transparency story.
5. Write a `draws` row: `prize_id`, `winning_entry_id`, `pool_size`, `method`
   (`'crypto.randomInt'`), `drawn_by`, `drawn_at`. All in one transaction.
6. Return the winning ticket number, entrant name, and pool size.

## Fairness config

```
EXCLUDE_PREVIOUS_WINNERS=true   # a person can win at most one prize
```

Whatever this is set to, it should be stated out loud at the event so the rule is known before
the draws happen.

## Presenting the draw live (POC helper)

- The winner reveal should be clear and unhurried — big ticket number, then the name. No need
  for animation in the POC, but leave room for it. The point is the team can judge whether a
  screen reveal feels authentic versus a physical drum.
- Show the pool size on screen at draw time ("drawn from 214 entries") — it reinforces fairness.

## Acceptance criteria

- [ ] `/admin` is unreachable without the secret.
- [ ] Each undrawn prize shows a working Draw button; drawn prizes show their winner.
- [ ] Drawing selects via `crypto.randomInt`, records pool size and method, and is stored atomically.
- [ ] A prize cannot be silently drawn twice.
- [ ] With `EXCLUDE_PREVIOUS_WINNERS=true`, no entrant wins two prizes across sequential draws.
- [ ] An empty eligible pool errors cleanly rather than crashing or picking nothing.
