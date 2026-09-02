# 05 — Managing a booking: magic links and local storage

No accounts, no passwords (D5). Identity is "demonstrably controls the email address the
booking was made with". Two mechanisms, one of which is only a convenience.

## Tokens

A magic link is a signed token in a URL:

```
https://meadowbrookdartington.org/bookings/MB-7K2QX4?t=<token>
```

Token = base64url of `{ jti, ref, email, exp }` plus an HMAC-SHA256 signature over the payload,
keyed with `BOOKING_MAGIC_LINK_SECRET` (32+ random bytes, Secret Manager). Not a JWT library —
a JWT here would add a dependency and an algorithm-confusion footgun for a payload we fully
control. Verify with a **constant-time** comparison.

Properties:

- **Scoped to one booking.** A token for `MB-7K2QX4` grants nothing about any other booking,
  even one made by the same person. Blast radius of a leaked link is one booking.
- **Reusable until expiry.** It is the only way in, so it has to survive being used. Expiry is
  `booking end + 30 days`, which covers "the receipt was in that email somewhere".
- **Revocable.** `tokens/{jti}` is checked on every use. Cancelling a booking revokes its
  token; re-issuing revokes the previous one.
- **Rate limited.** 20 uses per token per hour. A brute-force against the signature is
  infeasible, but the limit turns a leaked link into a noisy one.

### Leak containment

Tokens in URLs leak — into browser history, into `Referer` headers, into pasted screenshots.
Mitigations, all of which are cheap:

- `Referrer-Policy: no-referrer` on every `/bookings/*` response.
- On load, the server sets an `HttpOnly`, `Secure`, `SameSite=Lax` session cookie scoped to
  `/bookings` and the client immediately strips `?t=` via `history.replaceState`, so the token
  leaves the address bar and the browser history entry.
- `Cache-Control: no-store` on every page that renders booking details.
- No token, ever, in a log line, an analytics event or an error report. Log the `jti` instead.

## Local storage

Purely a convenience so a returning booker isn't emailed a link every time.

```
localStorage['mb.bookings'] = [ { ref: 'MB-7K2QX4', token: '...', end: '2026-09-05T16:00:00Z' } ]
```

- Written after a successful booking and after any magic-link visit.
- Entries past `end + 30 days` are pruned on read.
- Drives a "Your bookings" list on `/bookings` and a discreet banner on a facility page when
  the visitor has an upcoming booking for that room.
- **Never trusted for authorisation.** Every write path re-verifies the token server-side.
  Local storage decides what to *show a link to*, never what to *permit*.

## Lost your link

`/bookings/find` — enter an email address, get links to your upcoming bookings.

- Always responds "If we hold bookings for that address, we've emailed you a link", whether or
  not any exist. No account enumeration.
- Rate limited: 3 requests per email per hour, 10 per IP per hour.
- Emails links only for bookings that have not yet ended.
- Each link is a freshly issued token; issuing revokes the previous one for that booking.

## Amend: another time

`/bookings/{ref}/amend` → the same slot picker as booking, for the same room, with the current
booking's own slot shown as available (you can't be blocked by yourself).

```
1  Verify token → booking. Must be 'confirmed', not yet started, and
   MORE THAN 1 HOUR from its start. Inside the cancellation window a
   booking is fixed -- otherwise amending is a way out of the window
   (move it to next week at the same price, then cancel for a full
   refund). See 04.
2  Show availability, excluding this booking's own calendar event from busy.
3  On submit: re-price the new slot server-side.
4  Firestore transaction: overlap-check the new slot (ignoring this booking),
   write a hold for it.
5  Re-check calendar freebusy for the new slot.
6  Money, per refundFor():
     dearer  → charge the difference. Fails → abort, nothing changes.
     cheaper → move first, then refund. A refund that fails is recoverable
               by hand; a booking left in limbo is not.
     equal   → nothing.
7  Patch the calendar event to the new time (patch, don't delete-and-recreate
   — it keeps the event ID stable and doesn't spam anyone who has it).
8  Update the booking, append history { action: 'amend-time', from, to }.
9  Release the hold, invalidate caches, send the amendment email.
```

Room changes are **not** amendments. Different room, different price, different calendar —
cancel and rebook. The UI says so rather than hiding the option.

## Amend: duration

The same endpoint and the same transaction. Duration is another field on the amend form; a
change of start time, of duration, or of both is one operation with one price recalculation
and one money movement. Building these as two flows would mean two chances to get the money
wrong.

Shortening is bounded by `minDurationMins`; extending is bounded by `maxDurationMins`, closing
time, and whatever is booked next.

## Cancel

`/bookings/{ref}/cancel` — a confirmation step that states the refund amount in cash before
anything happens.

```
1  Verify token. Must be 'confirmed'.
2  refundFor(booking, 'cancel', now) → refundPence.
3  Show "You will be refunded £48.00" (or "This booking has already started,
   so no refund is due"). Require an explicit confirm.
4  Refund via Square. Fails → abort, tell the booker to contact the DRA,
   alert the owner. Never release a slot we haven't refunded.
5  Delete the calendar event.
6  status = 'cancelled', append history and the refund ledger entry.
7  Revoke the token. Invalidate caches. Send cancellation email; notify owner.
```

Refund before releasing the slot, because a released slot can be rebooked by someone else
within seconds and then the refund failure has no clean unwind.

## Acceptance criteria

- [ ] A valid token opens the booking; a tampered one is rejected with 403.
- [ ] A token for booking A grants no access to booking B.
- [ ] An expired token is rejected and offers `/bookings/find`.
- [ ] The `?t=` parameter is gone from the address bar after load, and the page still works on refresh.
- [ ] `/bookings/find` responds identically for a known and an unknown address.
- [ ] Amending shows the booking's current slot as selectable rather than busy.
- [ ] A failed amend-up charge leaves time, duration, calendar event and money untouched.
- [ ] Cancelling states the exact refund before confirming, and the confirm step is explicit.
- [ ] A failed refund leaves the booking confirmed and the slot held.
- [ ] Clearing local storage loses no access — the emailed link still works.
- [ ] No token value appears in any log line.
