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

## What `/donate` learned the hard way — read this before writing the card form

The DRA reports (31 Aug 2026) that `/donate` **needed substantial work after it went live**,
because the sandbox did not surface problems that production did. That is the single most
useful piece of information available about this integration, and it changes how Phase 2 should
be tested.

### 1. The sandbox is not a faithful rehearsal

Reported symptoms:

- **Extra payment steps appeared in production** that dev had barely exercised — 3-D Secure
  challenge flows.
- **Mastercard worked while Visa did not.** Card networks behave differently under SCA and the
  sandbox does not reproduce that spread.
- **The sandbox expects US billing details** — a ZIP code where production wants a UK postcode.

So passing every sandbox test is *not* evidence the card form works. Plan accordingly rather
than being surprised twice.

### 2. Therefore: a real-money test is part of Phase 2, not an afterthought

Before the booking form is advertised to anyone:

1. Switch booking to **production** Square credentials.
2. Make a **real booking with a real card**, for a real amount, on a real slot.
3. Repeat with **a Visa and a Mastercard** — the DRA has already been bitten by exactly this.
4. **Cancel it and confirm the refund lands**, which also tests the refund path with real money.
5. Only then open it up.

A £7.50 snooker booking is a cheap way to buy that certainty. Put it in the phase checklist so
it cannot be skipped.

### 3. Billing country differs between environments

`/donate` sends `billingContact.countryCode: 'GB'`, which is right for production. In the
sandbox the postal-code field validates as a US ZIP. Derive it from the environment rather than
hardcoding, so sandbox testing is not a fight:

```
const billingCountry = env === 'sandbox' ? 'US' : 'GB';
```

and be explicit in the code comment that this divergence is a sandbox artefact, not a real
requirement — otherwise someone will later "fix" production to match the sandbox.

### 4. Copy the tokenize call from `/donate` exactly

It is the version that works in production after being corrected there:

```js
await card.tokenize({
  amount: (pence / 100).toFixed(2),
  currencyCode: 'GBP',
  intent: 'CHARGE',
  customerInitiated: true,
  sellerKeyedIn: false,
  billingContact: { givenName, familyName, email, countryCode },
});
```

`verificationDetails` passed to `tokenize()` is what runs SCA inline; the returned token already
carries the verification, so the server-side charge needs nothing extra. Omitting this is what
produces `CARD_DECLINED_VERIFICATION_REQUIRED` from UK issuers under PSD2. Log the real error on
failure — an SCA failure with a generic message is undiagnosable.

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

### Pending refunds, and why `paidPence` looks wrong until Phase 5

Observed in the sandbox on 1 Sep 2026 and true in production: **Square returns a refund as
`PENDING`, not `COMPLETED`.** `paidPence` is derived from completed ledger entries only, which
is right — money that has not moved should not be counted as moved — so a just-cancelled
booking reads:

```
charge  2000p  completed
refund  2000p  pending
paidPence = 2000
```

That is correct at the instant of cancellation and **wrong an hour later**, because nothing
currently transitions the entry. Until the `refund.updated` webhook lands in Phase 5:

- every refunded booking keeps a `paidPence` that overstates what the DRA holds, and
- the income report (`07`) would inherit that overstatement.

Two consequences worth stating rather than discovering:

- **Phase 5's webhook is not optional polish.** It is what makes the ledger eventually true.
  Do not ship reporting to the treasurer before it.
- **The reconcile job should also sweep pending payments**, not only orphans — a webhook that
  is missed (delivery failure, a deploy mid-flight) otherwise leaves an entry pending forever.
  Query Square by refund id and settle it.

Nothing to fix in the cancel path itself: refusing to count pending money is the conservative
and correct behaviour, and the alternative — assuming a refund succeeded — is how a charity ends
up with books that do not balance.

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
