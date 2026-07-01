# 00 — Overview

## Purpose

A digital raffle for the DRA Extravaganza. Replace paper tickets with a QR-code entry flow,
online payment, and an in-person draw. The primary goal of *this build* is a **proof of
concept** the events team can see and play with, to decide whether a fully digital raffle
feels authentic to them.

## The flow (end to end)

1. Attendee scans a printed QR code → lands on `/raffle`.
2. They see the prizes, the price per entry, and an entry form.
3. They enter name, email, phone, and how many entries they want, and tick a consent box.
4. They pay via Square (sandbox for the POC).
5. On success they get a confirmation showing their ticket number(s).
6. Every entry is automatically in the draw for **every** prize.
7. On the day, an admin opens `/admin`, and for each prize presses a button to run that
   prize's draw. The winner is selected and recorded.
8. Winners are contacted using the details captured at entry.

## Key decisions (locked for the POC)

| Decision | Choice |
|---|---|
| Payment provider | **Square**, sandbox mode, test cards |
| Prizes | **Multiple**, each with its **own independent draw** |
| Entry → prize mapping | **One entry enters all prize draws automatically** (no choosing) |
| Multiple entries per person | **Allowed** — each entry is its own ticket / row |
| Same person winning twice | Configurable. Default: **a person can only win one prize** (previous winners excluded from later draws). See `05-admin-and-draw.md`. |
| Draw trigger | **Manual** — an admin presses a button per prize |
| Randomness | Node `crypto.randomInt` (cryptographically sound, not `Math.random`) |
| Admin access | Shared-secret / basic auth for POC only — **not** production-grade |

## Glossary

- **Entrant** — a person. One row per person (deduped by email).
- **Entry / ticket** — a single chance in the draw. A person can hold many. Has a
  human-readable ticket number (e.g. `MB-0042`).
- **Payment** — a Square transaction that produced one or more entries.
- **Prize** — a thing being drawn for. Has its own draw.
- **Draw** — the act of selecting a winning entry for a prize. Recorded, timestamped, auditable.

## Non-goals for the POC (explicitly out of scope)

- Real (live) Square payments — sandbox only.
- Refunds, partial refunds, payment reconciliation.
- Production-grade admin auth (SSO, roles).
- Bulk email sending to all entrants (winner contact is manual/one-off for POC).
- Fancy draw animations — a clear, honest reveal is enough for the POC.
- Multi-event support — this is one raffle, one event.

## Success criteria for the POC

- A teammate can scan a QR on their phone, complete the whole flow with a sandbox card, and
  receive a ticket number, without help.
- The public entries list shows their ticket, so they can see it's really in.
- An admin can run each prize draw and see a winner, and the result is stored and repeatable
  to inspect (who won what, when, from a pool of how many).
