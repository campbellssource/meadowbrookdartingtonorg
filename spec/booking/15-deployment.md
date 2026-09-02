# 15 — Deploying the booking system

What has to be true before `feat/booking-system` reaches production, and in what order.

Nothing here is optional in the sense of "it will probably work anyway" — each item is
something that fails at runtime rather than at build time, which is the worst kind.

## 1. Secrets (Secret Manager, `meadowbrookdartington`)

The deploy already uses `--update-secrets` for `SQUARE_ACCESS_TOKEN`; these join it.

| Secret | Where it comes from |
|---|---|
| `BOOKING_MAGIC_LINK_SECRET` | `openssl rand -base64 32`. Rotating it invalidates every live manage link |
| `BOOKING_CRON_SECRET` | `openssl rand -base64 32`. Only a fallback — Cloud Scheduler uses OIDC |
| `BOOKING_SQUARE_ACCESS_TOKEN` | Square dashboard, **production** credentials |
| `BOOKING_SQUARE_WEBHOOK_SIGNATURE_KEY` | Square, when the webhook subscription is created (step 4) |
| `BOOKING_ADMIN_OAUTH_CLIENT_SECRET` | The OAuth client created in step 3 |

```sh
printf '%s' "$(openssl rand -base64 32)" | \
  gcloud secrets create BOOKING_MAGIC_LINK_SECRET --data-file=- --project=meadowbrookdartington
```

## 2. Environment variables on the Cloud Run service

```
BOOKING_PROJECT_ID=meadowbrook-booking
BOOKING_IMPERSONATE_SA=booking-app@meadowbrook-booking.iam.gserviceaccount.com
BOOKING_NOTIFY_OWNER=true
BOOKING_ADMIN_EMAILS=michael.campbell@meadowbrookdartington.org
BOOKING_ADMIN_OAUTH_CLIENT_ID=<from step 3>
BOOKING_SQUARE_WEBHOOK_URL=https://meadowbrookdartington.org/api/booking/webhooks/square
PUBLIC_BOOKING_SQUARE_ENVIRONMENT=production
PUBLIC_BOOKING_SQUARE_APPLICATION_ID=<square production app id>
PUBLIC_BOOKING_SQUARE_LOCATION_ID=<square production location id>
```

**`BOOKING_IMPERSONATE_SA` is required in production.** It reads like a local convenience and
is not: the runtime SA has no roles on `meadowbrook-booking` and the calendars are shared with
`booking-app`. Unset means every read fails. See `08`.

**Do not set** `BOOKING_EMAIL_TRANSPORT` (production defaults to `brevo`, and `console` is
refused outright there) or `BOOKING_ADMIN_DEV_LOGIN` (refused when `NODE_ENV=production`).

## 3. Google OAuth client for `/admin`

Console → APIs & Services → Credentials → OAuth client ID → Web application.

- Authorised redirect URI: `https://meadowbrookdartington.org/admin/auth/callback`
- Add `http://localhost:4321/admin/auth/callback` too, so local sign-in uses the real flow

Until this exists, `/admin/signin` says so and offers the local sign-in instead.

## 4. Square webhook subscription

Square Developer dashboard → the production application → Webhooks → Subscriptions.

- URL: `https://meadowbrookdartington.org/api/booking/webhooks/square`
- Events: `payment.updated`, `refund.updated`
- Copy the signature key into `BOOKING_SQUARE_WEBHOOK_SIGNATURE_KEY`

The URL must match `BOOKING_SQUARE_WEBHOOK_URL` exactly — the signature is computed over the
URL concatenated with the body, so a trailing slash difference fails every delivery silently.

**This is the one thing that cannot be tested before deploying**, because Square cannot reach
`localhost`. The reconcile job covers the same ground hourly, so a broken webhook degrades
freshness rather than correctness — but check the logs after the first live refund.

## 5. Cloud Scheduler audience

The two jobs already exist in `meadowbrook-booking` and point at
`https://meadowbrookdartington.org/api/booking/cron/*` with an OIDC token whose audience is
that URL. `cron-auth.ts` checks both the audience and that the caller is `booking-scheduler`.
Nothing to change — but confirm the first runs succeed, because until this deploy those
endpoints returned 404.

## 6. Brevo

`bookings@meadowbrookdartington.org` is a verified sender with SPF and DKIM (question 19, done).
Nothing further needed; the transport switches to Brevo automatically in production.

## 7. The first live booking

Before telling anyone the form exists. `/donate` needed significant post-launch work because
the sandbox did not reproduce 3-D Secure, and Visa failed where Mastercard worked (`04`).

1. Book a real slot, real card, **Visa**. Complete any 3-D Secure challenge.
2. Check: confirmation email arrives, calendar event appears, door code is issued.
3. Repeat with a **Mastercard**.
4. Cancel one and confirm the refund reaches the card.
5. Check `/admin/bookings` shows both, and that the ledger settles.

£7.50 a time. Sandbox green is not evidence.

## 8. Only then

The booking form is reachable at `/book/[slug]` and linked from nowhere. Point the facility
pages at it when the DRA is ready — both systems run in parallel until Acuity is switched off
(`09`).

## Acceptance criteria

- [ ] All five secrets exist and the service starts.
- [ ] `/admin/bookings` loads with real data over Google sign-in, not the dev login.
- [ ] A test booking writes a calendar event and issues a door code.
- [ ] Both scheduled jobs report success in Cloud Logging.
- [ ] A live refund settles in the ledger within the hour, whether or not the webhook fired.
- [ ] Visa and Mastercard both complete a real payment.
