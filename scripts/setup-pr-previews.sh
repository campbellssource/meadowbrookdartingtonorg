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

echo "Done."
