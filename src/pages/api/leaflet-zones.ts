import type { APIRoute } from 'astro';
import { getZones } from '../../lib/leaflet';
import { getZoneState, isSheetConfigured } from '../../lib/leaflet-sheet';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const GET: APIRoute = async () => {
  try {
    const zones = await getZones();

    // If the sheet isn't reachable, still render the page with every zone
    // shown as available rather than failing outright.
    if (!isSheetConfigured()) {
      return json({
        zones: zones.map((z) => ({ ...z, taken: false, backupCount: 0, delivered: false })),
      });
    }

    try {
      const withState = await getZoneState(zones);
      return json({ zones: withState });
    } catch (sheetErr) {
      console.error('leaflet-zones sheet error:', sheetErr);
      return json({
        zones: zones.map((z) => ({ ...z, taken: false, backupCount: 0, delivered: false })),
      });
    }
  } catch (err) {
    console.error('leaflet-zones error:', err);
    return json(
      { error: 'Could not load the delivery zones right now. Please try again shortly.' },
      502
    );
  }
};
