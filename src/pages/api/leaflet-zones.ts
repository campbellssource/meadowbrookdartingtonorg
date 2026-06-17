import type { APIRoute } from 'astro';
import { getZonesWithStatus } from '../../lib/leaflet';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async () => {
  try {
    const zones = await getZonesWithStatus();
    return json({ zones });
  } catch (err) {
    console.error('leaflet-zones error:', err);
    return json(
      { error: 'Could not load the delivery zones right now. Please try again shortly.' },
      502
    );
  }
};
