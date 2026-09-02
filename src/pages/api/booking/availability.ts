// GET /api/booking/availability?room=<slug>&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Read-only. Reads the room's Google Calendar, applies the room's rules, and
// returns bookable starts with the lengths and prices available at each.
//
// Phase 1: no writes, no payments, no holds. Holds join the busy set in Phase 2 --
// `computeAvailability` already takes them, it is simply passed an empty list here.

import type { APIRoute } from 'astro';
import { getRoomConfig } from '../../../lib/booking/config-reader.ts';
import { fetchBusy, CalendarError } from '../../../lib/booking/calendar.ts';
import { computeAvailability, datesBetween } from '../../../lib/booking/availability.ts';
import { londonToInstant, instantToLocalDate, addMinutes } from '../../../lib/booking/time.ts';
import { rateLimit } from '../../../lib/booking/store.ts';

export const prerender = false;

/** Bounds the calendar query and the response size. */
const MAX_DAYS = 62;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (body: unknown, status = 200, cache?: string): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Short and shared: a hand-made calendar entry must disappear from
      // availability within a minute, which is the acceptance criterion in `02`.
      ...(cache ? { 'Cache-Control': cache } : { 'Cache-Control': 'no-store' }),
    },
  });

export const GET: APIRoute = async ({ url, clientAddress }) => {
  const slug = (url.searchParams.get('room') ?? '').trim();
  const today = instantToLocalDate(new Date());
  const from = (url.searchParams.get('from') ?? today).trim();
  const to = (url.searchParams.get('to') ?? from).trim();

  if (!slug) return json({ error: 'Missing ?room=' }, 400);
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return json({ error: 'from and to must be YYYY-MM-DD' }, 400);
  }
  if (from > to) return json({ error: 'from must not be after to' }, 400);

  const dates = datesBetween(from, to);
  if (dates.length > MAX_DAYS) {
    return json({ error: `Range too wide: ${dates.length} days, maximum ${MAX_DAYS}` }, 400);
  }

  // Every call spends Google Calendar quota. Browsing a fortnight is perhaps
  // twenty requests, so this is far above normal use and well below scraping.
  const limit = await rateLimit(`avail:ip:${clientAddress ?? 'unknown'}`, 200, 60);
  if (!limit.allowed) return json({ error: 'Too many requests. Please slow down.' }, 429);

  let room;
  try {
    room = await getRoomConfig(slug);
  } catch (err) {
    console.error('booking/availability: config error', err);
    return json({ error: 'Booking is not correctly configured for this room.' }, 500);
  }
  if (!room) return json({ error: `No bookable room "${slug}"` }, 404);

  // Widen the calendar window by the buffer so a booking sitting just outside the
  // range still pushes the first and last slots of it around correctly.
  const pad = Math.max(room.bufferMins, 60);
  const timeMin = addMinutes(londonToInstant(from, '00:00'), -pad);
  const timeMax = addMinutes(londonToInstant(dates[dates.length - 1], '23:59'), pad);

  try {
    const busy = await fetchBusy(room.calendarId, timeMin, timeMax);
    const result = computeAvailability({ room, from, to, busy, now: new Date() });
    return json({
      ...result,
      room: room.slug,
      shortName: room.shortName,
      hourlyRatePence: room.hourlyRatePence,
      capacityNote: room.capacityNote,
      intakeQuestions: room.intakeQuestions,
    }, 200, 'public, max-age=30, s-maxage=30');
  } catch (err) {
    const status = err instanceof CalendarError ? 502 : 500;
    console.error('booking/availability: calendar read failed', {
      room: slug, status, message: err instanceof Error ? err.message : String(err),
    });
    // Never fall back to "no busy blocks" -- that would render the room entirely
    // free and invite a double booking. Fail closed and say so.
    return json({ error: 'Could not read the room calendar. Please try again shortly.' }, status);
  }
};
