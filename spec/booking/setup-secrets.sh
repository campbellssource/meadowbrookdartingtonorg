#!/usr/bin/env bash
# Creates the Secret Manager entries the booking system needs, in the site's
# project. Safe to re-run: existing secrets are left alone unless --rotate is
# passed for the two we generate ourselves.
#
#   bash spec/booking/setup-secrets.sh
#
# Values you have to supply are prompted for. The two random ones are generated
# here so nobody has to invent them, and so they never sit in a shell history.

set -euo pipefail
PROJECT="${PROJECT:-meadowbrookdartington}"
ROTATE="${1:-}"

bold() { printf '\033[1;34m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

exists() { gcloud secrets describe "$1" --project="$PROJECT" >/dev/null 2>&1; }

put() { # name, value
  if exists "$1"; then
    printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- --project="$PROJECT" >/dev/null
    ok "$1 — new version added"
  else
    printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic \
      --project="$PROJECT" >/dev/null
    ok "$1 — created"
  fi
}

generated() { # name
  if exists "$1" && [[ "$ROTATE" != "--rotate" ]]; then
    ok "$1 — already set (pass --rotate to replace)"
    return
  fi
  if exists "$1"; then
    warn "$1 — rotating. Live magic links will stop working if this is the link secret."
  fi
  put "$1" "$(openssl rand -base64 32)"
}

# Checks a value looks right before storing it. Input is hidden, so a double-paste
# is invisible -- which is exactly what happened on the first run: a 64-character
# Square token stored as 128 characters, accepted silently, and only caught later
# when the API returned 401.
validate() { # name, value -> prints a complaint, or nothing
  local name="$1" value="$2" len=${#2}
  case "$name" in
    BOOKING_SQUARE_ACCESS_TOKEN)
      [[ "$value" =~ ^EAAA ]] || { echo "does not start with EAAA"; return; }
      (( len == 64 )) || echo "is $len characters; a Square access token is 64 (a doubled paste gives 128)"
      ;;
    BOOKING_SQUARE_WEBHOOK_SIGNATURE_KEY)
      (( len >= 20 && len <= 60 )) || echo "is $len characters, which is outside the usual range"
      ;;
    BOOKING_ADMIN_OAUTH_CLIENT_SECRET)
      [[ "$value" =~ ^GOCSPX- ]] || echo "does not start with GOCSPX-, which Google client secrets do"
      ;;
  esac
  # Catches the general case: any value that is exactly itself twice.
  local half=$(( len / 2 ))
  if (( len % 2 == 0 )) && [[ "${value:0:half}" == "${value:half}" ]]; then
    echo "appears to be the same value pasted twice"
  fi
}

prompted() { # name, description
  if exists "$1"; then ok "$1 — already set"; return; fi
  printf '  %s\n    %s\n    value (input hidden, blank to skip): ' "$1" "$2"
  read -rs value || true; echo
  if [[ -z "$value" ]]; then warn "$1 — skipped, deploy will fail until it is set"; return; fi

  local complaint
  complaint="$(validate "$1" "$value")"
  if [[ -n "$complaint" ]]; then
    warn "that value $complaint"
    printf '    store it anyway? [y/N]: '
    read -r answer || true
    [[ "$answer" == [yY] ]] || { warn "$1 — not stored"; return; }
  fi
  put "$1" "$value"
}

bold "Project: $PROJECT"
gcloud projects describe "$PROJECT" >/dev/null 2>&1 || { echo "  cannot reach $PROJECT"; exit 1; }

bold "Generated secrets"
generated BOOKING_MAGIC_LINK_SECRET
generated BOOKING_CRON_SECRET

bold "Secrets only you have"
prompted BOOKING_SQUARE_ACCESS_TOKEN \
  "Square PRODUCTION access token (Developer Dashboard > your app > Production > Access token)"
prompted BOOKING_SQUARE_WEBHOOK_SIGNATURE_KEY \
  "Square webhook signature key, shown when the subscription is created (see 15, step 4)"
prompted BOOKING_ADMIN_OAUTH_CLIENT_SECRET \
  "OAuth client secret for /admin sign-in (see 15, step 3)"

bold "Checking the Square token against Square"
if exists BOOKING_SQUARE_ACCESS_TOKEN; then
  tok="$(gcloud secrets versions access latest --secret=BOOKING_SQUARE_ACCESS_TOKEN --project="$PROJECT" 2>/dev/null)"
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $tok" \
    -H 'Square-Version: 2024-01-17' https://connect.squareup.com/v2/locations)"
  if [[ "$code" == "200" ]]; then
    ok "token works against Square production"
    curl -s -H "Authorization: Bearer $tok" -H 'Square-Version: 2024-01-17' \
      https://connect.squareup.com/v2/locations \
      | grep -oE '"id":"[A-Z0-9]+"' | head -1 \
      | sed 's/.*:"/    location id (for PUBLIC_BOOKING_SQUARE_LOCATION_ID): /;s/"$//'
  else
    warn "Square returned HTTP $code for that token — it will not take payments"
  fi
  unset tok
else
  warn "BOOKING_SQUARE_ACCESS_TOKEN not set, so nothing to check"
fi

bold "Already present for the existing site"
for s in BREVO_API_KEY SQUARE_ACCESS_TOKEN; do
  exists "$s" && ok "$s" || warn "$s — MISSING, and the site already needs it"
done

bold "Grant the Cloud Run service account read access"
SA="589136616970-compute@developer.gserviceaccount.com"
for s in BOOKING_MAGIC_LINK_SECRET BOOKING_CRON_SECRET BOOKING_SQUARE_ACCESS_TOKEN \
         BOOKING_SQUARE_WEBHOOK_SIGNATURE_KEY BOOKING_ADMIN_OAUTH_CLIENT_SECRET BREVO_API_KEY; do
  if exists "$s"; then
    gcloud secrets add-iam-policy-binding "$s" --project="$PROJECT" \
      --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" >/dev/null 2>&1 \
      && ok "$s readable by Cloud Run" || warn "$s — could not grant access"
  fi
done

bold "Still to do by hand"
cat <<'NOTE'
  GitHub repo variables (Settings > Secrets and variables > Actions > Variables):
    BOOKING_ADMIN_EMAILS                  michael.campbell@meadowbrookdartington.org
    BOOKING_ADMIN_OAUTH_CLIENT_ID         from the OAuth client
    PUBLIC_BOOKING_SQUARE_ENVIRONMENT     production
    PUBLIC_BOOKING_SQUARE_APPLICATION_ID  Square production application id
    PUBLIC_BOOKING_SQUARE_LOCATION_ID     Square production location id

  These are variables, not secrets: they reach the browser anyway.

  Then the OAuth client and the Square webhook subscription — spec/booking/15.
NOTE
