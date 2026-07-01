# 02 — Entry Flow (QR landing + form)

## Route

`GET /raffle` — the QR code points here. Public, no auth.

## Page content

- Short intro: what the raffle is, that it funds Meadowbrook (pool rebuild etc.), and that the
  draw happens live at the event.
- **Price per entry** (config value, e.g. `£2`). Make it a single env/config constant.
- List of prizes (from `prizes`, ordered by `display_order`) with donor credit.
- A note: "One entry goes into the draw for every prize."
- Link to the public entries list (`/entries`) — "see all entries here" — for transparency.
- The entry form.

## Form fields

| Field | Rules |
|---|---|
| Name | required, trimmed |
| Email | required, valid email, lowercased on save |
| Phone | required (needed to contact winners) |
| Quantity | integer 1–20 (cap configurable), default 1 |
| Consent | required checkbox: agree to be contacted if they win + privacy note |

Live total shown as `quantity × price` so there are no surprises before payment.

## Behaviour

- On submit, validate client-side, then create/find the entrant and a `pending` payment, and
  hand off to the Square payment step (`03-payments-square.md`). Do **not** create `entries`
  yet — tickets are only minted after payment completes.
- Dedupe entrants by lowercased email: if the email exists, reuse the entrant, update name/phone
  if changed, and refresh `consent_at`.
- Store `consent_at` at the moment the box is ticked and submitted.

## GDPR / privacy

- Collect the minimum: name, email, phone, consent. Nothing else.
- Consent copy must state the data is used only to run the raffle and contact winners, held by
  DRA, and how to request deletion. Link to the Meadowbrook privacy policy.
- Never put personal data in URLs or query strings.

## Acceptance criteria

- [ ] `/raffle` renders on a phone, lists prizes, shows price and live total.
- [ ] Invalid email / missing consent / quantity out of range are blocked with clear messages.
- [ ] Submitting creates an entrant (or reuses one) and a `pending` payment, then advances to payment.
- [ ] No `entries` rows exist for a payment that hasn't completed.
- [ ] Consent timestamp is recorded.
