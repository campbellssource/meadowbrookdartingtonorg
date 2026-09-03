// Reading configuration.
//
// Astro loads `.env` into `import.meta.env`, while Cloud Run sets real
// `process.env` variables. Neither alone covers both, so every lookup checks both
// -- the same pattern `lib/leaflet-sheet.ts` already uses, for the same reason.
//
// Getting this wrong is quiet: the variable reads as undefined, the code takes its
// "not configured" branch, and the feature is simply missing rather than broken.

type ImportMetaEnv = { env?: Record<string, string | undefined> };

export function env(name: string): string | undefined {
  return process.env[name] ?? (import.meta as unknown as ImportMetaEnv).env?.[name];
}

export function envBool(name: string, fallback: boolean): boolean {
  const raw = env(name);
  if (raw === undefined) return fallback;
  return raw !== 'false' && raw !== '0';
}

/**
 * The origin to use in links we email.
 *
 * `request.url` reflects the Host header, so deriving an emailed link from it lets
 * a forged Host put an attacker's domain into a real, signed magic link. Astro's
 * `security.allowedDomains` rejects unknown hosts today, which makes this defence
 * in depth rather than the only guard -- but a link that outlives the request and
 * lands in someone's inbox should not depend on a config entry staying in place.
 *
 * Falls back to the request origin only in development, where the host is
 * localhost and there is nothing to spoof.
 */
export function canonicalOrigin(requestOrigin: string): string {
  const configured = env('PUBLIC_SITE_ORIGIN') ?? env('ORIGIN');
  if (configured) return configured.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') return 'https://meadowbrookdartington.org';
  return requestOrigin;
}
