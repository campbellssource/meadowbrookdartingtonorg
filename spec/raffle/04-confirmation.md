# 04 — Confirmation & Public Entries List

Two things live here: the post-payment confirmation, and the public list that makes the whole
thing feel trustworthy.

## Confirmation

`GET /raffle/thanks?ref=<paymentId>` (or render inline after `/api/pay` returns).

- Show the ticket number(s) clearly and large — this is their receipt.
- Restate: "You're entered in the draw for every prize. Winners drawn live at the event."
- Point to `/entries` so they can immediately see their ticket in the public list.
- Optional (POC-optional): send a confirmation email via Brevo with the same ticket numbers.
  Stub this behind a flag `SEND_CONFIRMATION_EMAIL` — off by default for the POC.

## Public entries list

`GET /entries` — public, no auth. This is a core part of the transparency story.

- Show every entry: `ticket_number` + first name (or first name + last initial). **No** email,
  **no** phone.
- Show totals: number of entries, number of entrants.
- Optionally show a "last updated" timestamp.
- Order by ticket number.

This list is what lets anyone verify their ticket is genuinely in the pool before the draw —
the digital equivalent of watching your slip go into the drum.

## Acceptance criteria

- [ ] After paying, the user sees their exact ticket number(s).
- [ ] `/entries` shows those tickets, with no personal contact data exposed.
- [ ] Totals on `/entries` match the count of `entries` rows.
- [ ] Confirmation email is off by default and, when on, sends the correct ticket numbers.
