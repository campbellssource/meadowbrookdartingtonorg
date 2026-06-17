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

// A [lat, lng] pair (Leaflet's order).
export type LatLng = [number, number];

export interface Zone {
  id: string; // slug, for DOM ids only
  name: string; // canonical key - matches the map label and the sheet
  houses?: string; // approx house count, from the map's description field (e.g. "30", "7+1")
  houseCount?: number; // numeric total parsed from `houses`, for summing
  polygon?: LatLng[]; // outer boundary ring, for drawing the zone on the map
}

export interface Poster {
  name: string;
  lat: number;
  lng: number;
}

export interface MapData {
  zones: Zone[];
  posters: Poster[];
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

// KML <coordinates> are whitespace-separated "lon,lat[,alt]" tuples. Return
// [lat, lng] pairs (Leaflet order). Uses the first coordinates block in the
// placemark, which is the outer boundary (these zones have no holes/multi-part).
function parseCoords(block: string): LatLng[] {
  const m = block.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
  if (!m) return [];
  const out: LatLng[] = [];
  for (const tuple of m[1].trim().split(/\s+/)) {
    const [lon, lat] = tuple.split(',');
    const la = parseFloat(lat);
    const ln = parseFloat(lon);
    if (Number.isFinite(la) && Number.isFinite(ln)) out.push([la, ln]);
  }
  return out;
}

function parseName(block: string): string {
  const m = block.match(/<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/);
  return m ? decodeXml(m[1].trim()) : '';
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
    const name = parseName(block);
    if (!name) continue;
    let id = slugify(name);
    const dupes = seen.get(id) ?? 0;
    seen.set(id, dupes + 1);
    if (dupes > 0) id = `${id}-${dupes + 1}`;

    // The map's description field holds the approx house count (e.g. "30", "7+1").
    const descMatch = block.match(
      /<description>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/description>/
    );
    let houses: string | undefined;
    let houseCount: number | undefined;
    if (descMatch) {
      const cleaned = decodeXml(descMatch[1].replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned) {
        houses = cleaned;
        const nums = cleaned.match(/\d+/g);
        if (nums) houseCount = nums.reduce((a, n) => a + parseInt(n, 10), 0);
      }
    }

    const polygon = parseCoords(block);
    zones.push({ id, name, houses, houseCount, polygon });
  }
  return zones;
}

// Poster pin locations (the <Point> placemarks).
export function parsePosters(xml: string): Poster[] {
  const posters: Poster[] = [];
  const placemarkRe = /<Placemark\b[\s\S]*?<\/Placemark>/g;
  let m: RegExpExecArray | null;
  while ((m = placemarkRe.exec(xml)) !== null) {
    const block = m[0];
    if (!/<Point\b/.test(block)) continue;
    const coords = parseCoords(block);
    if (coords.length === 0) continue;
    posters.push({ name: parseName(block) || 'Poster', lat: coords[0][0], lng: coords[0][1] });
  }
  return posters;
}

let mapCache: { at: number; data: MapData } | null = null;
const MAP_TTL = 60_000;

export async function getMapData(): Promise<MapData> {
  if (mapCache && Date.now() - mapCache.at < MAP_TTL) return mapCache.data;
  const res = await fetch(KML_URL);
  if (!res.ok) throw new Error(`KML fetch failed: ${res.status}`);
  const xml = await res.text();
  const zones = parseZones(xml);
  if (zones.length === 0) throw new Error('KML returned no polygon zones');
  const data: MapData = { zones, posters: parsePosters(xml) };
  mapCache = { at: Date.now(), data };
  return data;
}

export async function getZones(): Promise<Zone[]> {
  return (await getMapData()).zones;
}

// --- Brevo (email only) ----------------------------------------------------

export async function addToBrevoList(opts: {
  email: string;
  firstName: string;
  lastName?: string;
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
  const attributes: Record<string, string> = {};
  if (opts.firstName.trim()) attributes.FIRSTNAME = opts.firstName.trim();
  if (opts.lastName?.trim()) attributes.LASTNAME = opts.lastName.trim();
  if (Object.keys(attributes).length) payload.attributes = attributes;

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
