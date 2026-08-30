#!/usr/bin/env bash
#
# Creates the GCP infrastructure for the Meadowbrook room booking system.
# See spec/booking/08-infrastructure.md for what this builds and why.
#
# Idempotent: safe to re-run. Every step checks before it creates.
#
# Usage:
#   gcloud auth login
#   BILLING_ACCOUNT=01802B-E42BD8-B2BD60 ./spec/booking/setup-gcp.sh
#
# Read this before running it. It creates a project and links billing.

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
PROJECT_ID="${PROJECT_ID:-meadowbrook-booking}"
PROJECT_NAME="${PROJECT_NAME:-Meadowbrook Booking}"
ORG_ID="${ORG_ID:-267698379938}"                       # meadowbrookdartington.org
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"                 # required
REGION="${REGION:-europe-west2}"                       # London. Firestore location is PERMANENT.

# The existing site, which will consume this infrastructure.
SITE_PROJECT="${SITE_PROJECT:-meadowbrookdartington}"
SITE_RUNTIME_SA="${SITE_RUNTIME_SA:-589136616970-compute@developer.gserviceaccount.com}"
SITE_URL="${SITE_URL:-https://meadowbrookdartington.org}"

APP_SA="booking-app"
SCHED_SA="booking-scheduler"
APP_SA_EMAIL="${APP_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
SCHED_SA_EMAIL="${SCHED_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

# Whoever runs this gets dev-time impersonation rights.
HUMAN="$(gcloud config get-value account 2>/dev/null)"

BUDGET_AMOUNT="${BUDGET_AMOUNT:-5}"                    # GBP/month alert threshold

say()  { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

if [[ -z "$BILLING_ACCOUNT" ]]; then
  echo "BILLING_ACCOUNT is required. Available:"
  gcloud billing accounts list
  exit 1
fi

say "Plan"
cat <<PLAN
  Project        ${PROJECT_ID}  ("${PROJECT_NAME}")
  Organisation   ${ORG_ID}
  Billing        ${BILLING_ACCOUNT}
  Region         ${REGION}   (Firestore location is permanent)
  App SA         ${APP_SA_EMAIL}
  Scheduler SA   ${SCHED_SA_EMAIL}
  Impersonated by ${SITE_RUNTIME_SA} (prod) and ${HUMAN} (dev)
PLAN
read -rp "  Proceed? [y/N] " reply
[[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "Aborted."; exit 0; }

# ── 1. Project ──────────────────────────────────────────────────────────────
say "Project"
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  ok "${PROJECT_ID} already exists"
else
  gcloud projects create "$PROJECT_ID" \
    --name="$PROJECT_NAME" \
    --organization="$ORG_ID"
  ok "created ${PROJECT_ID}"
fi

CURRENT_BILLING="$(gcloud billing projects describe "$PROJECT_ID" \
  --format='value(billingAccountName)' 2>/dev/null || true)"
if [[ "$CURRENT_BILLING" == *"$BILLING_ACCOUNT"* ]]; then
  ok "billing already linked"
else
  gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
  ok "billing linked to ${BILLING_ACCOUNT}"
fi

# The org nags about an 'environment' tag. Not fatal, and listing tag keys
# needs org-level permission this account doesn't have, so it's left to the
# console: IAM & Admin → Tags. Mentioned so the warning isn't a surprise.
warn "If the org warns about a missing 'environment' tag, add it in the console"

# ── 2. APIs ─────────────────────────────────────────────────────────────────
say "APIs"
gcloud services enable \
  firestore.googleapis.com \
  calendar-json.googleapis.com \
  iamcredentials.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com \
  --project="$PROJECT_ID"
ok "enabled"

# ── 3. Firestore ────────────────────────────────────────────────────────────
say "Firestore"
if gcloud firestore databases describe --project="$PROJECT_ID" >/dev/null 2>&1; then
  ok "database already exists"
else
  gcloud firestore databases create \
    --location="$REGION" \
    --type=firestore-native \
    --project="$PROJECT_ID"
  ok "created Native-mode database in ${REGION}"
fi

gcloud firestore databases update \
  --enable-pitr \
  --project="$PROJECT_ID" >/dev/null 2>&1 && ok "point-in-time recovery on" \
  || warn "could not enable PITR — set it in the console"

# TTL on holds, so expired slot reservations sweep themselves.
if gcloud firestore fields ttls describe expiresAt \
     --collection-group=holds --project="$PROJECT_ID" >/dev/null 2>&1; then
  ok "TTL policy on holds.expiresAt already set"
else
  gcloud firestore fields ttls update expiresAt \
    --collection-group=holds --enable-ttl --project="$PROJECT_ID" --quiet
  ok "TTL policy on holds.expiresAt"
fi

# Composite indexes: the overlap query, and the reminder/admin query.
add_index() {
  local group="$1"; shift
  gcloud firestore indexes composite create \
    --collection-group="$group" --query-scope=COLLECTION \
    "$@" --project="$PROJECT_ID" --quiet >/dev/null 2>&1 \
    && ok "index on ${group}: $*" || ok "index on ${group} already exists"
}
add_index bookings --field-config=field-path=room,order=ascending \
                   --field-config=field-path=localDate,order=ascending \
                   --field-config=field-path=status,order=ascending
add_index bookings --field-config=field-path=status,order=ascending \
                   --field-config=field-path=start,order=ascending

# ── 4. Service accounts ─────────────────────────────────────────────────────
say "Service accounts"
make_sa() {
  local name="$1" desc="$2"
  if gcloud iam service-accounts describe "${name}@${PROJECT_ID}.iam.gserviceaccount.com" \
       --project="$PROJECT_ID" >/dev/null 2>&1; then
    ok "${name} already exists"
  else
    gcloud iam service-accounts create "$name" \
      --display-name="$desc" --project="$PROJECT_ID"
    ok "created ${name}"
  fi
}
make_sa "$APP_SA"   "Meadowbrook booking app"
make_sa "$SCHED_SA" "Meadowbrook booking scheduler"

# The app SA reads and writes booking data.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${APP_SA_EMAIL}" \
  --role="roles/datastore.user" --condition=None >/dev/null
ok "${APP_SA} → roles/datastore.user"

# Production: the Cloud Run runtime SA impersonates the app SA.
gcloud iam service-accounts add-iam-policy-binding "$APP_SA_EMAIL" \
  --member="serviceAccount:${SITE_RUNTIME_SA}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="$PROJECT_ID" --condition=None >/dev/null
ok "${SITE_RUNTIME_SA} may impersonate ${APP_SA} (production)"

# Development: the human running this impersonates the same SA via ADC.
# No key file — the Workspace blocks SA key creation.
gcloud iam service-accounts add-iam-policy-binding "$APP_SA_EMAIL" \
  --member="user:${HUMAN}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="$PROJECT_ID" --condition=None >/dev/null
ok "${HUMAN} may impersonate ${APP_SA} (local dev)"

# ── 5. Cloud Scheduler ──────────────────────────────────────────────────────
say "Cloud Scheduler"
make_job() {
  local name="$1" schedule="$2" path="$3"
  if gcloud scheduler jobs describe "$name" \
       --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
    ok "${name} already exists"
  else
    gcloud scheduler jobs create http "$name" \
      --location="$REGION" \
      --schedule="$schedule" \
      --time-zone="Europe/London" \
      --uri="${SITE_URL}${path}" \
      --http-method=POST \
      --oidc-service-account-email="$SCHED_SA_EMAIL" \
      --oidc-token-audience="${SITE_URL}${path}" \
      --attempt-deadline=300s \
      --project="$PROJECT_ID"
    ok "created ${name}"
  fi
}
make_job booking-reminders "0 9 * * *"  "/api/booking/cron/reminders"
make_job booking-reconcile "15 * * * *" "/api/booking/cron/reconcile"

# ── 6. Budget alert ─────────────────────────────────────────────────────────
say "Budget"
if gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
     --format='value(displayName)' 2>/dev/null | grep -q "^${PROJECT_ID}-budget$"; then
  ok "budget already exists"
else
  gcloud billing budgets create \
    --billing-account="$BILLING_ACCOUNT" \
    --display-name="${PROJECT_ID}-budget" \
    --budget-amount="${BUDGET_AMOUNT}GBP" \
    --filter-projects="projects/$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')" \
    --threshold-rule=percent=0.5 \
    --threshold-rule=percent=0.9 \
    --threshold-rule=percent=1.0 2>/dev/null \
    && ok "budget alert at £${BUDGET_AMOUNT}/month" \
    || warn "could not create budget — needs roles/billing.admin. Set it in the console"
fi

# ── Done ────────────────────────────────────────────────────────────────────
say "Manual steps that gcloud cannot do"
cat <<MANUAL
  1. SHARE THE THREE CALENDARS with ${APP_SA_EMAIL}
     Permission: "Make changes to events"
       Snooker room        c_7d03780450348bae6a9fbe620e8d8d70254f5da1f058ca9a631e89a820850c71@group.calendar.google.com
       Studio - Large room c_c5f1e9f56d6290965b22e21e136bff0cc2bfefba5fd641b9902efe67a31b5cc7@group.calendar.google.com
       Lounge - Small room c_33f4213aac4c1fe8fb9a7a79b063d038b983bc79549f43fdb6bc93847c302977@group.calendar.google.com
     Without this every room looks permanently free.

  2. Create the secrets in ${SITE_PROJECT}:
       BOOKING_MAGIC_LINK_SECRET  (openssl rand -base64 32)
       BOOKING_SQUARE_ACCESS_TOKEN
       BOOKING_SQUARE_WEBHOOK_SIGNATURE_KEY
       BOOKING_ADMIN_OAUTH_CLIENT_SECRET
       BOOKING_CRON_SECRET        (openssl rand -base64 32)

  3. Create an OAuth 2.0 client (Web) in ${SITE_PROJECT} for /admin sign-in.
     Redirect URI: ${SITE_URL}/admin/auth/callback

  4. Create the Square webhook subscription → ${SITE_URL}/api/booking/webhooks/square
     Events: payment.updated, refund.updated

  5. Verify bookings@meadowbrookdartington.org as a Brevo sender (SPF + DKIM).

  Add to .env for local development:
    BOOKING_PROJECT_ID=${PROJECT_ID}
    BOOKING_IMPERSONATE_SA=${APP_SA_EMAIL}
MANUAL
say "Done"
