# 04 — Payments and refunds

Square, the same account that already powers `/donate`. `src/pages/api/donate.ts` is the
working reference for the charge call — reuse its shape, its `Square-Version` pin and its
error-logging discipline.

## Environment variables

Follow the raffle precedent: booking gets its **own** Square vars so a sandbox booking build
can never touch the live donation credentials.

| Var | Where | Notes |
|---|---|---|
| `PUBLIC_BOOKING_SQUARE_APPLICATION_ID` | client | |
| `PUBLIC_BOOKING_SQUARE_LOCATION_ID` | client | |
| `PUBLIC_BOOKING_SQUARE_ENVIRONMENT` | client | `sandbox` in dev, `production` live |
| `BOOKING_SQUARE_ACCESS_TOKEN` | server, Secret Manager | Never `PUBLIC_` |

In production these point at the same live Square account as donations, but through separate
variables — so flipping booking to sandbox for testing is one env change with no blast radius.

## Charging

Client tokenises the card with `tokenize(verificationDetails)` so Strong Customer
Authentication (3-D Secure) is carried by the token itself, exactly as `/donate` does today.
The server never sees card data.

```
POST {base}/v2/payments
  source_id:        <token from the client>
  idempotency_key:  <holdId>          // see below
  amount_money:     { amount: pricePence, currency: 'GBP' }
  location_id:      <location>
  buyer_email_address: <customer email>   // Square sends its own receipt
  reference_id:     <bookingRef>
  note:             "Meadowbrook room booking — Studio, 5 Sep 2026 14:00, MB-7K2QX4"
```

### Idempotency

The idempotency key is the **hold ID**, not a fresh UUID. A hold is created once per booking
attempt inside a transaction, so it is unique per attempt and stable across retries of that
attempt. A double-submitted form re-sends the same key and Square returns the original
payment instead of charging twice.

Every ledger entry stores the key it used. This is what makes orphan recovery possible: given
a hold ID we can always ask Square what happened, rather than guessing.

### SCA declines

`CARD_DECLINED_VERIFICATION_REQUIRED` gets the same clearer message `/donate` already uses.
Copy that handling; don't re-derive it.

## Refunds

Refunds are money moving the other way and get the same care as charges.

```
POST {base}/v2/refunds
  idempotency_key: <bookingRef>:<historyIndex>   // deterministic per refund event
  payment_id:      <the original charge>
  amount_money:    { amount: refundPence, currency: 'GBP' }
  reason:          "Booking cancelled by customer" | "Booking shortened"
```

The idempotency key is derived from the booking and the position in its history, so replaying
a cancellation cannot refund twice.

### The policy function

All refund arithmetic lives in one place: `refundFor(booking, change, now)` in
`src/lib/booking-policy.ts`. Pure, no I/O, exhaustively unit-tested.

Per D4, the v1 policy is:

| Change | Money |
|---|---|
| Cancel more than 1 hour before start | Refund `paidPence` in full |
| Cancel within 1 hour of start, or after it | Refund nothing |
| Amend to a dearer slot | Charge the difference. Booking only moves if the charge succeeds |
| Amend to a cheaper slot | Refund the difference |
| Amend to the same price | No money moves |

The function takes a `CANCELLATION_WINDOW_HOURS` config value, **set to `1` for v1**. Setting
it to `24` or `48` later needs no code change.

`refundFor` is also called **at checkout**, with `now = bookedAt`, purely to ask "would
cancelling this right now refund anything?". When the answer is no — which happens whenever a
booking is made inside the window, routine for Snooker — the booking form must say so before
the card is charged. Same function, so the warning and the actual refund can never disagree.

### Partial refunds across multiple charges

A booking amended upward twice has several charges in its ledger. Refunds are applied
**newest charge first**, splitting across payments as needed, because the most recent charge
is the most likely to still be refundable within Square's window. The ledger records one
`refund` entry per Square refund, each with its own `squareRefundId`.

## Webhooks

`POST /api/booking/webhooks/square` — signature-verified with
`BOOKING_SQUARE_WEBHOOK_SIGNATURE_KEY`, rejecting anything that fails.

Subscribe to `payment.updated` and `refund.updated`. Two jobs:

1. **Orphan recovery.** A completed payment whose `reference_id` matches no booking, or whose
   booking is still `held`, means we crashed between charging and persisting. Look up the
   hold by idempotency key. If the slot is still free, complete the booking. If it isn't,
   refund in full. Alert the owner either way.
2. **Ledger truth.** Reflect any status change Square reports — a refund that later fails, a
   payment disputed — onto the booking, and email the owner. Never silently diverge from Square.

Webhook handlers must be idempotent: Square retries, and the same event will arrive twice.
Key on Square's event ID and no-op on a repeat.

## Reconciliation for the treasurer

The admin reporting page (`07`) reads Firestore, which is our record, not Square's. Once a
month those must be checked against each other. `/admin/reporting` exposes a "Square
reconciliation" view listing any booking whose ledger disagrees with Square's payment status,
so a discrepancy is found by looking rather than by a bank statement six weeks later.

## Money rules

Non-negotiable, and worth stating because these are the bugs that cost real money:

- **Integer pence everywhere.** No floats touch money, not even in transit.
- **The server prices. Always.** A price arriving from a client is a log line, never an input.
- **Never retry a charge on timeout.** Query by idempotency key and act on the answer.
- **Never refund without a ledger entry**, and never write the ledger entry before Square confirms.
- **Never delete a payments entry.** Correct by appending.

## Acceptance criteria

- [ ] A sandbox booking end-to-end produces one payment, one booking, one calendar event.
- [ ] Submitting the booking form twice within a second results in exactly one Square charge.
- [ ] Cancelling before the start refunds the full amount and records a `refund` ledger entry.
- [ ] Cancelling after the start refunds nothing and says so plainly to the booker.
- [ ] Amending 60 → 90 minutes charges only the difference.
- [ ] Amending 90 → 60 minutes refunds only the difference.
- [ ] A failed amend-up charge leaves the original booking and calendar event untouched.
- [ ] Replaying a cancellation request refunds once.
- [ ] A webhook delivered twice changes state once.
- [ ] A webhook with a bad signature is rejected with 401 and logged.
