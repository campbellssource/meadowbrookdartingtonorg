// POST/GET /api/booking/cron/reminders — daily, from Cloud Scheduler.
//
// Reminds people the day before. Includes the manage link, so a late cancellation
// is one click rather than a phone call to a volunteer.

import type { APIRoute } from 'astro';
import { authoriseCron } from '../../../../lib/booking/cron-auth.ts';
import { sendReminders } from '../../../../lib/booking/reminders.ts';

export const prerender = false;

const handler: APIRoute = async ({ request, url }) => {
  const auth = await authoriseCron(request, `${url.origin}/api/booking/cron/reminders`);
  if (!auth.ok) {
    console.warn('cron/reminders: refused', auth.reason);
    return new Response('Unauthorised.', { status: 401 });
  }

  try {
    const report = await sendReminders(url.origin);
    console.log('cron/reminders: done', { ...report, via: auth.via });
    return new Response(JSON.stringify(report), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('cron/reminders: failed', err);
    return new Response('Failed.', { status: 500 });
  }
};

export const POST = handler;
export const GET = handler;
