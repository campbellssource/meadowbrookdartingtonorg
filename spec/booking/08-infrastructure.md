# 08 — Infrastructure

Per D2, booking data gets its **own** GCP project. The site keeps running where it runs.

```
meadowbrookdartington  (589136616970)      meadowbrook-booking  (new)
─────────────────────────────────────      ──────────────────────────────
Cloud Run  meadowbrook-site                Firestore (Native, europe-west2)
Artifact Registry                          SA  booking-app@…
Secret Manager  (all secrets)              Cloud Scheduler  (2 jobs)
WIF pool  github-actions                   Budget alert
Runtime SA 589136616970-compute
        │
        └── impersonates ──────────────►   booking-app@meadowbrook-booking
                                                     │
                                           ┌─────────┴──────────┐
                                    roles/datastore.user    shared on the
                                    in the booking project   3 room calendars
```

## Why one service account, impersonated from both sides

The Workspace blocks service-account key downloads (`iam.disableServiceAccountKeyCreation`) —
the raffle build already hit this. So there is no key file, in dev or in prod.

A single identity, `booking-app@meadowbrook-booking.iam.gserviceaccount.com`, is impersonated
by the Cloud Run runtime SA in production and by Michael's `gcloud` ADC in development. That
gives one identity to share the three calendars with, one set of IAM grants, and code whose
auth path is identical in both environments — the class of bug where something works locally
and not in production simply doesn't arise.

Credential resolution in `src/lib/google-auth.ts`, matching the existing `leaflet-sheet.ts`
pattern:

```
GOOGLE_SERVICE_ACCOUNT_JSON  (escape hatch; unset everywhere today)
  → BOOKING_IMPERSONATE_SA   (impersonate via ADC — dev and prod)
  → plain ADC                (last resort)
```

## Secrets stay in the site project

Secret Manager is not booking infrastructure; it is where the Cloud Run service reads its
configuration from, and that service already mounts secrets from `meadowbrookdartington` via
`--update-secrets`. Splitting them across two projects would add cross-project IAM for no gain.

New secrets to create:

| Secret | What |
|---|---|
| `BOOKING_MAGIC_LINK_SECRET` | 32 random bytes, base64. Signing key for magic links |
| `BOOKING_SQUARE_ACCESS_TOKEN` | Square server token for booking |
| `BOOKING_SQUARE_WEBHOOK_SIGNATURE_KEY` | From the Square webhook subscription |
| `BOOKING_ADMIN_OAUTH_CLIENT_SECRET` | Google OAuth client for `/admin` sign-in |
| `BOOKING_CRON_SECRET` | Fallback shared secret on the scheduled endpoints |

## Firestore

- **Native mode**, location `europe-west2`. **The location is permanent** — it cannot be
  changed after creation without recreating the database, so get it right first time.
- Rules: the app reaches Firestore through a service account with the Admin SDK, which bypasses
  security rules. Ship a `firestore.rules` that **denies all client access** anyway, so an
  accidental client-side SDK later fails closed.
- **TTL policy on `holds.expiresAt`**, so expired holds are swept without a cron job.
- Composite index: `bookings` on `(room ASC, localDate ASC, status ASC)` — the overlap query.
- Composite index: `bookings` on `(status ASC, start ASC)` — the reminder job and admin list.
- Point-in-time recovery on. It is pennies and this is the only copy of the booking records.

## Cloud Scheduler

Both jobs live in the booking project and call the site over HTTPS with an OIDC token from a
dedicated `booking-scheduler@` SA. The Cloud Run service is `--allow-unauthenticated` (it is a
public website), so **the endpoints verify the OIDC token themselves** — audience and caller
email — using `google-auth-library`, which is already a dependency. `BOOKING_CRON_SECRET` in a
header is a belt-and-braces second check.

| Job | Schedule | Endpoint |
|---|---|---|
| `booking-reminders` | `0 9 * * *` Europe/London | `POST /api/booking/cron/reminders` |
| `booking-reconcile` | `15 * * * *` | `POST /api/booking/cron/reconcile` |

Both must be idempotent — Scheduler retries. The reminder job records `reminderSentAt` on the
booking and skips anything already sent.

## Calendar access — manual, and the easiest step to get wrong

`gcloud` cannot share a Google Calendar. Do this by hand, once, for **each of the three
calendars**:

1. Google Calendar → the calendar's **Settings and sharing**
2. **Share with specific people or groups** → **Add people**
3. Add `booking-app@meadowbrook-booking.iam.gserviceaccount.com`
4. Permission: **Make changes to events** (not "See all event details" — we must write)

Without this the service account sees an empty calendar and every room looks free. If
availability comes back suspiciously wide open, this is why.

## Cost

| Item | Estimate |
|---|---|
| Firestore | Free tier: 50k reads / 20k writes per day. This uses a rounding error of it | £0 |
| Calendar API | Free | £0 |
| Cloud Scheduler | First 3 jobs free | £0 |
| Cloud Run | Existing service, marginal extra CPU | ~£0 |
| Square | Per transaction, unchanged from today | — |
| **Total new spend** | | **≈ £0/month** |
| **Acuity, removed** | | **−£16–40/month** |

Set a budget alert at £5/month regardless. Free tiers are free until a loop isn't.

## Setup

`setup-gcp.sh` in this folder does everything scriptable, and is idempotent — safe to re-run.

```bash
gcloud auth login                        # session credentials are currently expired
gcloud billing accounts list             # note the billing account ID
BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX ./spec/booking/setup-gcp.sh
```

Read it before running it. It creates a project and links billing, which costs money if the
free tiers are ever exceeded.

Then, by hand: share the three calendars (above), create the OAuth client for `/admin`, create
the Square webhook subscription, and verify the Brevo sender.

## Acceptance criteria

- [ ] `setup-gcp.sh` runs clean twice in a row with no errors on the second run.
- [ ] Firestore is Native mode in `europe-west2` with PITR enabled.
- [ ] The TTL policy on `holds.expiresAt` removes an expired hold without any application code.
- [ ] The runtime SA can read and write Firestore in the booking project via impersonation, with no key file.
- [ ] Local `npm run dev` reaches the same Firestore and the same calendars via ADC impersonation.
- [ ] All three calendars return real busy blocks to the service account.
- [ ] A Cloud Scheduler job reaches its endpoint and is accepted; the same request without a valid OIDC token is rejected.
- [ ] A budget alert exists at £5/month.
