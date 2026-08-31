// Google Calendar access.
//
// The calendars are the source of truth for whether a room is occupied (D1), so
// this reads them rather than trusting anything we hold ourselves. Every event
// counts, whoever created it: committee blocks, Acuity bookings and our own.

import { getAccessToken } from './google-auth.ts';
import type { Interval } from './time.ts';

const BASE = 'https://www.googleapis.com/calendar/v3';

async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

export class CalendarError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CalendarError';
  }
}

/**
 * Busy blocks for one calendar over a window.
 *
 * `freeBusy` rather than `events.list` on purpose: it returns occupancy without
 * returning event bodies, so the availability path never handles hirers' names,
 * phone numbers or email addresses at all. Least data, least exposure, and a
 * smaller response.
 */
export async function fetchBusy(calendarId: string, timeMin: Date, timeMax: Date): Promise<Interval[]> {
  const res = await authedFetch(`${BASE}/freeBusy`, {
    method: 'POST',
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: 'Europe/London',
      items: [{ id: calendarId }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new CalendarError(
      `freeBusy failed for ${calendarId}: ${res.status} ${detail.slice(0, 200)}`, res.status,
    );
  }

  const body = await res.json() as {
    calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }>;
  };
  const entry = body.calendars?.[calendarId];

  // A per-calendar error arrives inside a 200. Treating that as "no busy blocks"
  // would render the room completely free and let it be double-booked, so it has
  // to be an error here rather than an empty array.
  if (entry?.errors?.length) {
    throw new CalendarError(
      `freeBusy returned errors for ${calendarId}: ${entry.errors.map((e) => e.reason).join(', ')}`, 502,
    );
  }
  if (!entry) throw new CalendarError(`freeBusy returned no data for ${calendarId}`, 502);

  return (entry.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}
