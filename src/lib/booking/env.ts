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
