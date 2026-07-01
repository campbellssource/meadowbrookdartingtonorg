# 03 — Payments (Square, sandbox)

Square only, **sandbox** mode for the POC. Use the Web Payments SDK on the client to tokenise
the card, and the Payments API on the server to take the payment.

## Config (env)

```
SQUARE_ENV=sandbox
SQUARE_APP_ID=sandbox-sq0idb-xxxx        # public, used client-side
SQUARE_LOCATION_ID=xxxx
SQUARE_ACCESS_TOKEN=EAAAl...             # server-side only, never sent to client
RAFFLE_PRICE_PENNIES=200                 # £2 per entry
```

## Client (in the entry page)

- Load the Square Web Payments SDK for the **sandbox** environment.
- Initialise a Card payment element with `SQUARE_APP_ID` + `SQUARE_LOCATION_ID`.
- On pay, tokenise the card to get a `sourceId` (nonce). Send `sourceId`, entrant details, and
  quantity to the server endpoint. Never send raw card details anywhere.

## Server endpoint

`POST /api/pay`

Request: `{ entrantId, paymentId, sourceId, quantity }`

Steps:
1. Recompute amount server-side: `quantity × RAFFLE_PRICE_PENNIES`. **Never trust a
   client-supplied amount.**
2. Call Square `CreatePayment` with the `sourceId`, amount, `GBP`, and an **idempotency key**
   (use `paymentId`) so retries don't double-charge.
3. On success: mark the `payments` row `completed`, store `square_payment_id`, then mint
   `quantity` `entries` rows with fresh ticket numbers, in one transaction.
4. On failure: mark `payments` `failed`, mint nothing, return a clear error.
5. Return the created ticket numbers.

## Sandbox test cards

- Success: `4111 1111 1111 1111`, any future expiry, any CVV, any postcode.
- Use Square's documented sandbox cards for declines/3DS if testing failure paths.

## Idempotency & integrity

- One idempotency key per payment attempt (the `paymentId`).
- Ticket minting and payment-status update happen in a **single DB transaction** — never
  half-mint tickets.
- If Square says success but the DB write fails, log loudly; do not silently drop it.

## Non-goals (POC)

- No refunds, no webhooks/reconciliation, no live keys. Sandbox only.

## Acceptance criteria

- [ ] A sandbox card completes payment and returns ticket numbers.
- [ ] Amount is computed server-side; tampering with a client amount has no effect.
- [ ] Retrying the same payment does not create duplicate charges or duplicate tickets.
- [ ] A declined card produces no tickets and a clear error.
- [ ] Access token is never exposed to the client bundle.
