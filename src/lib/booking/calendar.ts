// Google Calendar access.
//
// The calendars are the source of truth for whether a room is occupied (D1), so
// this reads them rather than trusting anything we hold ourselves. Every event
// counts, whoever created it: committee blocks, Acuity bookings and our own.

import { getAccessToken } from './google-auth.ts';
import { isProductionCalendar } from './config.ts';
import type { Interval } from './time.ts';
import { londonToInstant } from './time.ts';

const BASE = 'https://www.googleapis.com/calendar/v3';

async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

export class CalendarError extends Error {
  // Written out longhand rather than as a parameter property: Node's
  // --experimental-strip-types removes types without transforming, so
  // `constructor(readonly status: number)` is a syntax error there and would
  // break every test that imports this module.
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CalendarError';
    this.status = status;
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

// --- Writing -------------------------------------------------------------

/**
 * Marker carried by every event this system writes outside production.
 *
 * The DRA tests against the real room calendars rather than throwaway ones,
 * because the door-lock system (`spec/booking/13`) only watches the real ones --
 * a booking written anywhere else proves nothing about whether a hirer can
 * actually get into the building.
 *
 * This marker is what makes that safe. Cleanup that deletes "the events we made"
 * trusts our own records to be correct. Cleanup that refuses to touch anything
 * without this string cannot destroy a real booking even when those records are
 * wrong, the date arithmetic is off, or the wrong calendar is targeted.
 */
export const TEST_EVENT_MARKER = '[TEST EVENT]';

const isTestEnv = (): boolean => process.env.NODE_ENV !== 'production';

const carriesMarker = (e: { summary?: string; description?: string }): boolean =>
  `${e.summary ?? ''} ${e.description ?? ''}`.includes(TEST_EVENT_MARKER);

/** Refuses to write an unmarked event to a live room calendar outside production. */
export function assertWritableEvent(calendarId: string, event: CalendarEventInput): void {
  if (!isTestEnv() || !isProductionCalendar(calendarId)) return;
  if (carriesMarker(event)) return;
  throw new CalendarError(
    `Refusing to write an unmarked event to the live calendar ${calendarId} while NODE_ENV is `
    + `"${process.env.NODE_ENV ?? 'undefined'}". Test events must contain "${TEST_EVENT_MARKER}".`,
    500,
  );
}

/**
 * Refuses to delete an unmarked event from a live room calendar outside production.
 *
 * Deliberately takes the event as Google returns it, never our own record of what
 * we think we wrote. A stale or wrong local record is exactly the situation this
 * guard exists to survive.
 */
export function assertDeletableEvent(
  calendarId: string, fetched: { summary?: string; description?: string },
): void {
  if (!isTestEnv() || !isProductionCalendar(calendarId)) return;
  if (carriesMarker(fetched)) return;
  throw new CalendarError(
    `Refusing to delete an event from the live calendar ${calendarId}: it does not carry `
    + `"${TEST_EVENT_MARKER}", so it may be a real booking.`,
    500,
  );
}

export interface CalendarEventInput {
  summary: string;
  description: string;
  start: Date;
  end: Date;
}

export interface CalendarEvent extends CalendarEventInput { id: string }

export interface RawEvent {
  id: string; summary?: string; description?: string;
  status?: string;
  // "Free" events. freeBusy omits them, so anything deriving busy time from
  // events.list has to omit them too or the two disagree.
  transparency?: string;
  // All-day events carry `date` instead of `dateTime`. A committee member blocking
  // a whole day for a jumble sale creates one of these.
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
}

const toEvent = (r: RawEvent): CalendarEvent => ({
  id: r.id,
  summary: r.summary ?? '',
  description: r.description ?? '',
  start: new Date(r.start?.dateTime ?? 0),
  end: new Date(r.end?.dateTime ?? 0),
});

const body = (e: CalendarEventInput) => ({
  summary: e.summary,
  description: e.description,
  start: { dateTime: e.start.toISOString(), timeZone: 'Europe/London' },
  end: { dateTime: e.end.toISOString(), timeZone: 'Europe/London' },
});

export async function createEvent(calendarId: string, event: CalendarEventInput): Promise<CalendarEvent> {
  assertWritableEvent(calendarId, event);
  const res = await authedFetch(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', body: JSON.stringify(body(event)) },
  );
  if (!res.ok) {
    throw new CalendarError(`createEvent failed: ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
  }
  return toEvent(await res.json() as RawEvent);
}

/**
 * Fetches an event, or `null` if it is gone.
 *
 * "Gone" has three spellings and only one of them is a 404. Deleting an event does
 * not remove it from the API: `events.get` keeps returning **HTTP 200** with
 * `status: "cancelled"` for a long time afterwards. Treating that as "still there"
 * makes deletes look like they failed, and would leave the reconcile job (`08`)
 * unable to notice that a booking's calendar entry had been cancelled — the exact
 * drift it exists to catch.
 */
export async function getEvent(calendarId: string, eventId: string): Promise<CalendarEvent | null> {
  const res = await authedFetch(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) {
    throw new CalendarError(`getEvent failed: ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
  }
  const raw = await res.json() as RawEvent;
  if (raw.status === 'cancelled') return null;
  return toEvent(raw);
}

export async function updateEvent(
  calendarId: string, eventId: string, event: CalendarEventInput,
): Promise<CalendarEvent> {
  assertWritableEvent(calendarId, event);
  const existing = await getEvent(calendarId, eventId);
  // Moving a real booking is as destructive as deleting one, so it gets the same guard.
  if (existing) assertDeletableEvent(calendarId, existing);
  const res = await authedFetch(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PUT', body: JSON.stringify(body(event)) },
  );
  if (!res.ok) {
    throw new CalendarError(`updateEvent failed: ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
  }
  return toEvent(await res.json() as RawEvent);
}

/** Deletes an event. Already-gone counts as success, so retries are safe. */
export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  const existing = await getEvent(calendarId, eventId);
  if (!existing) return;
  assertDeletableEvent(calendarId, existing);
  const res = await authedFetch(
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new CalendarError(`deleteEvent failed: ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
  }
}

/**
 * Busy intervals with one event excluded.
 *
 * Amending needs "free, ignoring my own booking" -- otherwise a hirer extending
 * from one hour to two is blocked by themselves. `freeBusy` returns intervals with
 * no ids, so it cannot express that; `events.list` can.
 */
export async function fetchBusyExcluding(
  calendarId: string, timeMin: Date, timeMax: Date, excludeEventId: string | null,
): Promise<Interval[]> {
  return busyFromRaw(await listRaw(calendarId, timeMin, timeMax), excludeEventId);
}

/**
 * The freeBusy-equivalent reduction of events.list, split out to be testable.
 *
 * Every other availability read in the system goes through freeBusy. This one
 * cannot, because freeBusy returns intervals with no ids and amending needs one
 * event ignored. So the rules freeBusy applies have to be reproduced here, and a
 * mismatch is invisible in either direction: the amend grid silently disagrees
 * with the booking grid about which slots are free.
 */
export function busyFromRaw(raw: RawEvent[], excludeEventId: string | null): Interval[] {
  return raw
    .filter((r) => r.id !== excludeEventId)
    .filter((r) => r.status !== 'cancelled')
    // "Free" events -- someone's personal reminder on a room calendar. freeBusy
    // omits them, so they must not block a room here either.
    .filter((r) => r.transparency !== 'transparent')
    .map(toInterval)
    .filter((i): i is Interval => i !== null);
}

/**
 * An event's occupied interval, all-day events included.
 *
 * `listEvents` drops anything without a `dateTime` because its callers want timed
 * events they can rewrite. Busy time cannot: an all-day "HALL CLOSED" blocks the
 * room exactly as a timed event does, and freeBusy reports it. Dropping it here
 * would let someone amend into a day the building is shut.
 */
function toInterval(r: RawEvent): Interval | null {
  if (r.start?.dateTime && r.end?.dateTime) {
    return { start: new Date(r.start.dateTime), end: new Date(r.end.dateTime) };
  }
  if (r.start?.date && r.end?.date) {
    // Google's all-day end date is exclusive, and both are wall dates, so they are
    // resolved in London rather than UTC -- during BST midnight UTC is 01:00 local.
    return { start: londonToInstant(r.start.date, '00:00'), end: londonToInstant(r.end.date, '00:00') };
  }
  return null;
}

/** Every event in a window, used by the cleanup script and the reconcile job. */
export async function listEvents(calendarId: string, timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
  // Timed events only: every caller here wants an event it can identify and rewrite.
  return (await listRaw(calendarId, timeMin, timeMax))
    .filter((r) => r.start?.dateTime)
    .map(toEvent);
}

/** The paginated events.list read. Shared by listEvents and fetchBusyExcluding. */
async function listRaw(calendarId: string, timeMin: Date, timeMax: Date): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await authedFetch(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    if (!res.ok) {
      throw new CalendarError(`listEvents failed: ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
    }
    const page = await res.json() as { items?: RawEvent[]; nextPageToken?: string };
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}
