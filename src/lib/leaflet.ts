// Leaflet-drop volunteer sign-up.
//
// The Google "My Maps" map is the single source of truth for the delivery
// zones: we read its KML export live (each <Placemark> with <Polygon> geometry
// is a zone), so editing zones in My Maps flows straight through to the site.
//
// Claim state (who is delivering / backing up which zone) is stored in Brevo:
// each volunteer is one contact in the "Leaflet volunteers" list, with their
// zones held in two text attributes. "Taken / available" is computed by reading
// that list. Brevo is not transactional, so two people claiming the same free
// zone within the status-cache window could both be marked primary - rare for a
// village leaflet drop, and backups make it low-stakes; reconcile in Brevo.

const MAP_ID = '1mI15lkSHXE2W_HikzgmSkwl5bDckbdM';
const KML_URL = `https://www.google.com/maps/d/kml?mid=${MAP_ID}&forcekml=1`;

const BREVO_BASE = 'https://api.brevo.com/v3';
const ZONE_DELIM = ';';
const PRIMARY_ATTR = 'PRIMARY_ZONES';
const BACKUP_ATTR = 'BACKUP_ZONES';

export interface Zone {
  id: string; // slug, for DOM ids only
  name: string; // canonical key - matches the map label and the Brevo attribute
}

export interface ZoneStatus extends Zone {
  taken: boolean;
  backupCount: number;
}

export type ClaimRole = 'primary' | 'backup';

export interface ClaimOutcome {
  zone: string;
  role: ClaimRole;
}

interface BrevoContact {
  email: string;
  attributes: Record<string, unknown>;
}

// --- env -------------------------------------------------------------------

export function getConfig() {
  const apiKey = process.env.BREVO_API_KEY ?? import.meta.env.BREVO_API_KEY;
  const listId = Number(
    process.env.BREVO_LEAFLET_LIST_ID ?? import.meta.env.BREVO_LEAFLET_LIST_ID
  );
  if (!apiKey || !listId) return null;
  return { apiKey: apiKey as string, listId };
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
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'zone';
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

// --- Brevo -----------------------------------------------------------------

function brevoHeaders(apiKey: string) {
  return {
    'api-key': apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function parseZoneAttr(v: unknown): string[] {
  if (typeof v !== 'string' || !v.trim()) return [];
  return v
    .split(ZONE_DELIM)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinZones(set: Set<string>): string {
  return [...set].join(`${ZONE_DELIM} `);
}

async function getListContacts(
  apiKey: string,
  listId: number
): Promise<BrevoContact[]> {
  const out: BrevoContact[] = [];
  const limit = 500;
  let offset = 0;
  // Cap iterations as a safety net; a leaflet drop won't approach this.
  for (let i = 0; i < 20; i++) {
    const res = await fetch(
      `${BREVO_BASE}/contacts/lists/${listId}/contacts?limit=${limit}&offset=${offset}`,
      { headers: brevoHeaders(apiKey) }
    );
    if (!res.ok) throw new Error(`Brevo list read failed: ${res.status}`);
    const data = await res.json();
    const contacts: any[] = data.contacts ?? [];
    for (const c of contacts) {
      out.push({ email: String(c.email ?? ''), attributes: c.attributes ?? {} });
    }
    if (contacts.length < limit) break;
    offset += limit;
  }
  return out;
}

export function computeStatus(zones: Zone[], contacts: BrevoContact[]): ZoneStatus[] {
  const primary = new Set<string>();
  const backupCounts = new Map<string, number>();
  for (const c of contacts) {
    for (const z of parseZoneAttr(c.attributes[PRIMARY_ATTR])) primary.add(z);
    for (const z of parseZoneAttr(c.attributes[BACKUP_ATTR])) {
      backupCounts.set(z, (backupCounts.get(z) ?? 0) + 1);
    }
  }
  return zones.map((z) => ({
    ...z,
    taken: primary.has(z.name),
    backupCount: backupCounts.get(z.name) ?? 0,
  }));
}

let statusCache: { at: number; status: ZoneStatus[] } | null = null;
const STATUS_TTL = 30_000;

export async function getZonesWithStatus(): Promise<ZoneStatus[]> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL) {
    return statusCache.status;
  }
  const cfg = getConfig();
  if (!cfg) throw new Error('Brevo not configured');
  const [zones, contacts] = await Promise.all([
    getZones(),
    getListContacts(cfg.apiKey, cfg.listId),
  ]);
  const status = computeStatus(zones, contacts);
  statusCache = { at: Date.now(), status };
  return status;
}

function invalidateStatus() {
  statusCache = null;
}

// --- claim -----------------------------------------------------------------

export async function submitClaim(opts: {
  email: string;
  firstName: string;
  phone?: string;
  zones: string[];
}): Promise<{ ok: true; outcomes: ClaimOutcome[] } | { ok: false; error: string }> {
  const cfg = getConfig();
  if (!cfg) return { ok: false, error: 'Server configuration error.' };

  const email = opts.email.trim().toLowerCase();
  const validZones = new Set((await getZones()).map((z) => z.name));
  // Keep only real zone names; de-dupe.
  const requested = [...new Set(opts.zones.map((z) => z.trim()))].filter((z) =>
    validZones.has(z)
  );
  if (requested.length === 0) {
    return { ok: false, error: 'Please choose at least one zone.' };
  }

  const contacts = await getListContacts(cfg.apiKey, cfg.listId);

  // Zones already led by *someone else*.
  const heldByOthers = new Set<string>();
  for (const c of contacts) {
    if (c.email.toLowerCase() === email) continue;
    for (const z of parseZoneAttr(c.attributes[PRIMARY_ATTR])) heldByOthers.add(z);
  }

  const me = contacts.find((c) => c.email.toLowerCase() === email);
  const myPrimary = new Set(me ? parseZoneAttr(me.attributes[PRIMARY_ATTR]) : []);
  const myBackup = new Set(me ? parseZoneAttr(me.attributes[BACKUP_ATTR]) : []);

  const outcomes: ClaimOutcome[] = [];
  for (const zone of requested) {
    let role: ClaimRole;
    if (myPrimary.has(zone)) {
      role = 'primary';
    } else if (heldByOthers.has(zone)) {
      role = 'backup';
      myBackup.add(zone);
    } else {
      role = 'primary';
      myPrimary.add(zone);
      myBackup.delete(zone); // a zone is never both
    }
    outcomes.push({ zone, role });
  }

  const attributes: Record<string, string> = {
    [PRIMARY_ATTR]: joinZones(myPrimary),
    [BACKUP_ATTR]: joinZones(myBackup),
  };
  if (opts.firstName.trim()) attributes.FIRSTNAME = opts.firstName.trim();
  // Optional WhatsApp number - stored as plain text (not Brevo's strict
  // SMS/WHATSAPP field) so UK "07..." numbers aren't rejected.
  if (opts.phone?.trim()) attributes.WHATSAPP_NUMBER = opts.phone.trim();

  const res = await fetch(`${BREVO_BASE}/contacts`, {
    method: 'POST',
    headers: brevoHeaders(cfg.apiKey),
    body: JSON.stringify({
      email,
      listIds: [cfg.listId],
      updateEnabled: true,
      attributes,
    }),
  });

  if (res.status !== 201 && res.status !== 204) {
    let msg = 'Something went wrong saving your sign-up. Please try again.';
    try {
      const body = await res.json();
      if (body?.message) msg = body.message;
    } catch {
      /* ignore */
    }
    return { ok: false, error: msg };
  }

  invalidateStatus();
  return { ok: true, outcomes };
}
