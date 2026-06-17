// Leaflet-drop volunteer sign-up.
//
// Zones come live from the Google "My Maps" KML export (each <Placemark> with
// <Polygon> geometry is a zone), so editing zones in My Maps flows straight
// through to the site.
//
// Claim state (who's leading / backing up / has delivered each zone) lives in a
// Google Sheet - see ./leaflet-sheet.ts. Brevo is used only to collect the
// volunteer's email into the mailing list (no custom attributes needed, so it
// works on the free plan).

const MAP_ID = '1mI15lkSHXE2W_HikzgmSkwl5bDckbdM';
const KML_URL = `https://www.google.com/maps/d/kml?mid=${MAP_ID}&forcekml=1`;

const BREVO_BASE = 'https://api.brevo.com/v3';

export interface Zone {
  id: string; // slug, for DOM ids only
  name: string; // canonical key - matches the map label and the sheet
}

export interface ZoneStatus extends Zone {
  taken: boolean;
  backupCount: number;
  delivered: boolean;
}

export type ClaimRole = 'primary' | 'backup';

export interface ClaimOutcome {
  zone: string;
  role: ClaimRole;
}

// --- KML parsing -----------------------------------------------------------

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'zone'
  );
}

export function parseZones(xml: string): Zone[] {
  const zones: Zone[] = [];
  const seen = new Map<string, number>();
  const placemarkRe = /<Placemark\b[\s\S]*?<\/Placemark>/g;
  let m: RegExpExecArray | null;
  while ((m = placemarkRe.exec(xml)) !== null) {
    const block = m[0];
    // Delivery zones are polygons; poster pins are points - skip those.
    if (!/<Polygon\b/.test(block)) continue;
    const nameMatch = block.match(
      /<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/
    );
    const name = nameMatch ? decodeXml(nameMatch[1].trim()) : '';
    if (!name) continue;
    let id = slugify(name);
    const dupes = seen.get(id) ?? 0;
    seen.set(id, dupes + 1);
    if (dupes > 0) id = `${id}-${dupes + 1}`;
    zones.push({ id, name });
  }
  return zones;
}

let zoneCache: { at: number; zones: Zone[] } | null = null;
const ZONE_TTL = 60_000;

export async function getZones(): Promise<Zone[]> {
  if (zoneCache && Date.now() - zoneCache.at < ZONE_TTL) return zoneCache.zones;
  const res = await fetch(KML_URL);
  if (!res.ok) throw new Error(`KML fetch failed: ${res.status}`);
  const xml = await res.text();
  const zones = parseZones(xml);
  if (zones.length === 0) throw new Error('KML returned no polygon zones');
  zoneCache = { at: Date.now(), zones };
  return zones;
}

// --- Brevo (email only) ----------------------------------------------------

export async function addToBrevoList(opts: {
  email: string;
  firstName: string;
}): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY ?? import.meta.env.BREVO_API_KEY;
  const listId = Number(
    process.env.BREVO_LEAFLET_LIST_ID ?? import.meta.env.BREVO_LEAFLET_LIST_ID
  );
  if (!apiKey || !listId) {
    // Don't fail the whole sign-up if the mailing list isn't configured - the
    // sheet claim is the important bit. Just log and move on.
    console.warn('Brevo not configured; skipping mailing-list add');
    return;
  }

  const payload: Record<string, unknown> = {
    email: opts.email.trim().toLowerCase(),
    listIds: [listId],
    updateEnabled: true,
  };
  if (opts.firstName.trim()) {
    payload.attributes = { FIRSTNAME: opts.firstName.trim() };
  }

  const res = await fetch(`${BREVO_BASE}/contacts`, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  // 201 created / 204 updated are both fine; anything else we log but swallow.
  if (res.status !== 201 && res.status !== 204) {
    console.warn('Brevo add failed:', res.status, await res.text().catch(() => ''));
  }
}
