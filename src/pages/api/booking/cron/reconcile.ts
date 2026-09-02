// POST/GET /api/booking/cron/reconcile — hourly, from Cloud Scheduler.
//
// The safety net. Settles pending money, restores missing calendar events, and
// reports abandoned checkouts. Written so that if the Square webhook never fired
// at all, the books would still come right within the hour.

import type { APIRoute } from 'astro';
import { authoriseCron } from '../../../../lib/booking/cron-auth.ts';
import { reconcile } from '../../../../lib/booking/reconcile.ts';

export const prerender = false;

const handler: APIRoute = async ({ request, url }) => {
  const auth = await authoriseCron(request, `${url.origin}/api/booking/cron/reconcile`);
  if (!auth.ok) {
    console.warn('cron/reconcile: refused', auth.reason);
    return new Response('Unauthorised.', { status: 401 });
  }

  const started = Date.now();
  try {
    const report = await reconcile();
    console.log('cron/reconcile: done', { ...report, ms: Date.now() - started, via: auth.via });
    return new Response(JSON.stringify(report), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('cron/reconcile: failed', err);
    return new Response('Failed.', { status: 500 });
  }
};

export const POST = handler;
export const GET = handler;
