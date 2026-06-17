import type { APIRoute } from 'astro';
import { submitClaim } from '../../lib/leaflet';

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

  try {
    const result = await submitClaim({ email, firstName, phone, zones });
    if (!result.ok) return json({ error: result.error }, 502);
    return json({ success: true, outcomes: result.outcomes });
  } catch (err) {
    console.error('leaflet-claim error:', err);
    return json({ error: 'Something went wrong. Please try again.' }, 502);
  }
};
