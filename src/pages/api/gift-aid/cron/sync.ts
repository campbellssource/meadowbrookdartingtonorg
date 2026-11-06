// POST/GET /api/gift-aid/cron/sync — hourly, from Cloud Scheduler.
//
// The guarantee behind "a sheet failure never loses a record": anything in
// Firestore that has not reached the bookkeeper's sheet, or has a change the sheet
// has not seen, is sent again. Idempotent -- a row already in the sheet is found
// by its ID and not appended twice.

import type { APIRoute } from 'astro';
import { authoriseCron } from '../../../../lib/booking/cron-auth.ts';
import { syncPending } from '../../../../lib/gift-aid/sync.ts';
import { firestoreStore } from '../../../../lib/gift-aid/store.ts';
import { googleSheets } from '../../../../lib/gift-aid/sheets.ts';

export const prerender = false;

const handler: APIRoute = async ({ request, url }) => {
  const auth = await authoriseCron(request, `${url.origin}/api/gift-aid/cron/sync`);
  if (!auth.ok) {
    console.warn('cron/gift-aid-sync: refused', auth.reason);
    return new Response('Unauthorised.', { status: 401 });
  }
  try {
    const report = await syncPending(firestoreStore, googleSheets);
    console.log('cron/gift-aid-sync: done', { ...report, via: auth.via });
    return new Response(JSON.stringify(report), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('cron/gift-aid-sync: failed', err);
    return new Response('Failed.', { status: 500 });
  }
};

export const POST = handler;
export const GET = handler;
