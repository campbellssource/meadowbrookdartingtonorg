import type { APIRoute } from 'astro';
import { getZones, addToBrevoList } from '../../lib/leaflet';
import { recordClaim, isSheetConfigured } from '../../lib/leaflet-sheet';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request }) => {
  let email = '';
  let firstName = '';
  let phone = '';
  let zones: string[] = [];

  try {
    const body = await request.json();
    email = String(body.email ?? '').trim();
    firstName = String(body.firstName ?? '').trim();
    phone = String(body.phone ?? '').trim();
    zones = Array.isArray(body.zones) ? body.zones.map((z: unknown) => String(z)) : [];
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }
  if (zones.length === 0) {
    return json({ error: 'Please choose at least one zone.' }, 400);
  }
  if (!isSheetConfigured()) {
    return json({ error: 'Sign-ups are not available right now. Please try again later.' }, 503);
  }

  try {
    // Only record real zone names from the map; de-dupe.
    const valid = new Set((await getZones()).map((z) => z.name));
    const requested = [...new Set(zones.map((z) => z.trim()))].filter((z) => valid.has(z));
    if (requested.length === 0) {
      return json({ error: 'Please choose at least one valid zone.' }, 400);
    }

    const outcomes = await recordClaim({ email, name: firstName, phone, zones: requested });

    // Add to the mailing list (best-effort; never blocks the claim).
    await addToBrevoList({ email, firstName }).catch((e) =>
      console.warn('Brevo add error:', e)
    );

    return json({ success: true, outcomes });
  } catch (err) {
    console.error('leaflet-claim error:', err);
    return json({ error: 'Something went wrong saving your sign-up. Please try again.' }, 502);
  }
};
