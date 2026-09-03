// A small in-process cache for the read path.
//
// Availability is the only thing a visitor hits repeatedly — clicking around a
// week is a request per day — and each one costs a Google Calendar round trip plus
// a Keystatic read off disk. Roughly two thirds of a second, every time, for an
// answer that changes rarely.
//
// In-process on purpose. Cloud Run may run several instances, so this is not a
// shared cache and does not pretend to be: each instance keeps its own copy for a
// few seconds. That is the right trade here because the cost of a stale answer is
// bounded — a slot that looks free and is not gets refused at the point of
// purchase by the hold transaction (`store.ts`) and again by the calendar re-check
// in `create.ts`. The cache can only ever cause a booking to be *refused* slightly
// oddly, never double-sold.

interface Entry<T> { value: T; expires: number }

const store = new Map<string, Entry<unknown>>();

/** Room config barely changes; availability must not lag a hand-made calendar block. */
export const CONFIG_TTL_MS = 60_000;
export const AVAILABILITY_TTL_MS = 20_000;

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await load();
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

/**
 * Drops everything for a room. Called on every write, so a booker who has just
 * taken a slot does not see it offered back to them a second later.
 */
export function invalidateRoom(slug: string): void {
  for (const key of store.keys()) {
    if (key.includes(`|${slug}|`) || key.startsWith(`${slug}|`)) store.delete(key);
  }
}

/** Test seam, and used when config is edited in development. */
export function clearCache(): void { store.clear(); }

/** Rough size, for a health check. */
export const cacheSize = (): number => store.size;

// --- in-process rate limiting ---------------------------------------------

interface Window { start: number; count: number }
const windows = new Map<string, Window>();

/**
 * A rate limit that costs nothing.
 *
 * `store.rateLimit()` is a Firestore transaction, which is correct where the limit
 * protects something that matters — booking creation, link recovery — and is the
 * dominant cost on a read endpoint hit once per date click. Availability is a read
 * whose limit exists to protect Google Calendar quota, so an approximate
 * per-instance count is the right shape: several Cloud Run instances each allow
 * the limit, which is a ceiling a few times higher than configured and still far
 * below anything worth worrying about.
 */
export function rateLimitLocal(
  key: string, limit: number, windowMins: number, now = Date.now(),
): boolean {
  const w = windows.get(key);
  if (!w || now - w.start > windowMins * 60_000) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 5000) {
      // Unbounded growth would be a slow leak; the oldest entries are stale anyway.
      for (const [k, v] of windows) if (now - v.start > windowMins * 60_000) windows.delete(k);
    }
    return true;
  }
  if (w.count >= limit) return false;
  w.count += 1;
  return true;
}
