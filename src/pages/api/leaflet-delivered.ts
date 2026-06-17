import type { APIRoute } from 'astro';
import { markDelivered, isSheetConfigured } from '../../lib/leaflet-sheet';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request }) => {
  let email = '';
  let zone = '';
  try {
    const body = await request.json();
    email = String(body.email ?? '').trim();
    zone = String(body.zone ?? '').trim();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  if (!email || !zone) {
    return json({ error: 'Missing details.' }, 400);
  }
  if (!isSheetConfigured()) {
    return json({ error: 'Not available right now.' }, 503);
  }

  try {
    const result = await markDelivered({ email, zone });
    if (!result.ok) return json({ error: result.error }, 400);
    return json({ success: true });
  } catch (err) {
    console.error('leaflet-delivered error:', err);
    return json({ error: 'Something went wrong. Please try again.' }, 502);
  }
};
