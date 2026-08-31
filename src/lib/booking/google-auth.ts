// Google credentials for the booking system.
//
// Three ways in, tried in order, because the DRA's Workspace makes the obvious
// one impossible: `iam.disableServiceAccountKeyCreation` is enforced on the
// domain, so there are no downloadable service-account keys to pass around.
//
//   1. GOOGLE_SERVICE_ACCOUNT_JSON  -- an inline key, if one ever exists
//   2. BOOKING_IMPERSONATE_SA       -- impersonate via your own gcloud ADC (local dev)
//   3. plain ADC                    -- the Cloud Run runtime service account (production)
//
// Local dev and production therefore share one code path and one identity
// (`booking-app@meadowbrook-booking`), which is why "works on my machine" means
// something here. See spec/booking/08-infrastructure.md.

import { GoogleAuth, Impersonated } from 'google-auth-library';

export const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar'];

type Client = { getAccessToken(): Promise<string | null | { token?: string | null }> };

let cached: Client | null = null;

function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as { env?: Record<string, string> }).env?.[name];
}

async function build(): Promise<Client> {
  const inlineKey = env('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (inlineKey) {
    return new GoogleAuth({ scopes: CALENDAR_SCOPES, credentials: JSON.parse(inlineKey) });
  }

  const impersonate = env('BOOKING_IMPERSONATE_SA');
  if (impersonate) {
    const sourceClient = await new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    }).getClient();
    return new Impersonated({
      sourceClient,
      targetPrincipal: impersonate,
      lifetime: 3600,
      delegates: [],
      targetScopes: CALENDAR_SCOPES,
    });
  }

  return new GoogleAuth({ scopes: CALENDAR_SCOPES });
}

/** A bearer token for the Calendar API. Clients are cached; tokens are refreshed. */
export async function getAccessToken(): Promise<string> {
  cached ??= await build();
  const raw = await cached.getAccessToken();
  const token = typeof raw === 'string' ? raw : raw?.token;
  if (!token) throw new Error('Could not obtain a Google access token for the booking system');
  return token;
}

/** Test seam: forget the cached client. */
export function resetAuthCache(): void { cached = null; }
