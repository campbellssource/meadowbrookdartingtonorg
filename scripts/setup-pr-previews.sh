#!/usr/bin/env bash
# One-off GCP setup for PR previews (.github/workflows/preview.yml).
# Safe to re-run: every step either checks first or is idempotent.
#
# Creates:
#   - meadowbrook-previews   Artifact Registry repo, with a cleanup policy
#   - site-preview-runtime   service account the preview service runs as (no roles)
#   - github-preview-deploy  service account GitHub Actions deploys previews as;
#                            can touch only the preview service and image repo
#   - meadowbrook-site-preview  Cloud Run service, public, scales to zero
#
# And, for sandbox donations on previews (spec/gift-aid/01, "PR previews"):
#   - PREVIEW_SQUARE_ACCESS_TOKEN  secret: a Square SANDBOX token, readable by the
#                            preview runtime and by the deploy account (which
#                            manages each PR's sandbox webhook subscription)
#   - Firestore database "preview" in meadowbrook-booking, with TTL on intents
#   - site-preview-runtime gets roles/datastore.user on THAT database only, by an
#     IAM condition. It has no access to the production (default) database.
#
# The sandbox token is read from PREVIEW_SQUARE_ACCESS_TOKEN in the environment,
# or prompted for. It must be a sandbox token: it is checked against Square's
# sandbox API and refused if production accepts it.
set -euo pipefail

PROJECT=meadowbrookdartington
PROJECT_NUMBER=589136616970
REGION=europe-west2
REPO=meadowbrook-previews
SERVICE=meadowbrook-site-preview
GITHUB_REPO=campbellssource/meadowbrookdartingtonorg
RUNTIME_SA=site-preview-runtime@$PROJECT.iam.gserviceaccount.com
DEPLOY_SA=github-preview-deploy@$PROJECT.iam.gserviceaccount.com
WIF_PRINCIPAL="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github-actions/attribute.repository/$GITHUB_REPO"

g() { gcloud --project="$PROJECT" --quiet "$@"; }

echo "== Artifact Registry repo"
g artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 ||
  g artifacts repositories create "$REPO" --location="$REGION" --repository-format=docker \
    --description="PR preview images (auto-cleaned)"

# Delete images older than 30 days, but always keep the 15 newest so a quiet,
# long-running PR's preview still has its image.
POLICY=$(mktemp)
cat > "$POLICY" <<'JSON'
[
  {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"olderThan": "2592000s"}},
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 15}}
]
JSON
g artifacts repositories set-cleanup-policies "$REPO" --location="$REGION" \
  --policy="$POLICY" --no-dry-run
rm -f "$POLICY"

echo "== Service accounts"
for SA in site-preview-runtime github-preview-deploy; do
  g iam service-accounts describe "$SA@$PROJECT.iam.gserviceaccount.com" >/dev/null 2>&1 ||
    g iam service-accounts create "$SA" --display-name="$SA"
done

echo "== Preview service (placeholder image until the first PR deploys)"
g run services describe "$SERVICE" --region="$REGION" >/dev/null 2>&1 ||
  g run deploy "$SERVICE" --region="$REGION" \
    --image=us-docker.pkg.dev/cloudrun/container/hello \
    --service-account="$RUNTIME_SA" \
    --allow-unauthenticated \
    --min-instances=0 --max-instances=2

echo "== Deploy account permissions (scoped to preview resources only)"
g artifacts repositories add-iam-policy-binding "$REPO" --location="$REGION" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/artifactregistry.writer >/dev/null
g run services add-iam-policy-binding "$SERVICE" --region="$REGION" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/run.developer >/dev/null
g iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser >/dev/null

echo "== Let GitHub Actions in this repo act as the deploy account"
g iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --member="$WIF_PRINCIPAL" --role=roles/iam.workloadIdentityUser >/dev/null

echo "== Sandbox Square token for previews"
SECRET=PREVIEW_SQUARE_ACCESS_TOKEN
if ! g secrets describe "$SECRET" >/dev/null 2>&1; then
  TOKEN="${PREVIEW_SQUARE_ACCESS_TOKEN:-}"
  if [[ -z "$TOKEN" ]]; then read -rsp "  Square SANDBOX access token (hidden): " TOKEN; echo; fi
  sq() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" -H 'Square-Version: 2024-01-17' "$1/v2/locations"; }
  [[ "$(sq https://connect.squareupsandbox.com)" == 200 ]] || { echo "  That token does not work against the Square sandbox."; exit 1; }
  [[ "$(sq https://connect.squareup.com)" != 200 ]] || { echo "  That is a PRODUCTION token. Refusing."; exit 1; }
  printf '%s' "$TOKEN" | g secrets create "$SECRET" --data-file=- --replication-policy=automatic >/dev/null
  unset TOKEN
fi
for SA in "$RUNTIME_SA" "$DEPLOY_SA"; do
  g secrets add-iam-policy-binding "$SECRET" --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor >/dev/null
done

echo "== Preview Firestore database (separate from production's default database)"
BOOKING_PROJECT=meadowbrook-booking
gcloud --project="$BOOKING_PROJECT" --quiet firestore databases describe --database=preview >/dev/null 2>&1 ||
  gcloud --project="$BOOKING_PROJECT" --quiet firestore databases create --database=preview \
    --location="$REGION" --type=firestore-native
gcloud --project="$BOOKING_PROJECT" --quiet firestore fields ttls update expiresAt \
  --collection-group=donationIntents --database=preview --enable-ttl >/dev/null 2>&1 || true
gcloud --project="$BOOKING_PROJECT" --quiet projects add-iam-policy-binding "$BOOKING_PROJECT" \
  --member="serviceAccount:$RUNTIME_SA" --role=roles/datastore.user \
  --condition="expression=resource.name == 'projects/$BOOKING_PROJECT/databases/preview',title=preview-database-only,description=PR previews may use the preview database and nothing else" \
  >/dev/null

echo "Done."
echo "By hand, once: share the TEST copy of the Gift Aid sheet (10r2WxQ…) with"
echo "  $RUNTIME_SA as Editor. Never share the real one with it."
