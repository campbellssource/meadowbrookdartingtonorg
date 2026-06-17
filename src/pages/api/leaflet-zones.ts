import type { APIRoute } from 'astro';
import { getMapData } from '../../lib/leaflet';
import { getZoneState, isSheetConfigured } from '../../lib/leaflet-sheet';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async () => {
  try {
    const { zones, posters } = await getMapData();

    // If the sheet isn't reachable, still render the map with every zone shown
    // as available rather than failing outright.
    const allAvailable = () =>
      zones.map((z) => ({ ...z, taken: false, backupCount: 0, delivered: false }));

    if (!isSheetConfigured()) {
      return json({ zones: allAvailable(), posters });
    }

    try {
      const withState = await getZoneState(zones);
      return json({ zones: withState, posters });
    } catch (sheetErr) {
      console.error('leaflet-zones sheet error:', sheetErr);
      return json({ zones: allAvailable(), posters });
    }
  } catch (err) {
    console.error('leaflet-zones error:', err);
    return json(
      { error: 'Could not load the delivery zones right now. Please try again shortly.' },
      502
    );
  }
};
