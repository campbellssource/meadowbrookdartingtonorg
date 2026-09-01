// Test-event tooling for the booking system.
//
//   npm run booking:check    round-trips one marked event through a real calendar
//   npm run booking:cleanup  removes every [TEST EVENT] and nothing else
//
// The DRA tests against the real room calendars, because the door-lock system
// only watches those (spec/booking/13). Every event this system writes outside
// production carries [TEST EVENT], and the delete guard refuses anything without
// it -- so cleanup cannot destroy a real booking even if this script is pointed
// at the wrong calendar or the wrong dates.

import {
  createEvent, getEvent, deleteEvent, listEvents, fetchBusy, TEST_EVENT_MARKER, assertDeletableEvent,
} from '../src/lib/booking/calendar.ts';
import { PRODUCTION_CALENDAR_IDS } from '../src/lib/booking/config.ts';

const ROOMS: Record<string, string> = {
  Snooker: PRODUCTION_CALENDAR_IDS[0],
  Studio: PRODUCTION_CALENDAR_IDS[1],
  Lounge: PRODUCTION_CALENDAR_IDS[2],
};

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m: string) => console.log(`  · ${m}`);
const hdr = (m: string) => console.log(`\n\x1b[1;34m▸ ${m}\x1b[0m`);

const isTestEvent = (e: { summary: string; description: string }) =>
  `${e.summary} ${e.description}`.includes(TEST_EVENT_MARKER);

async function check(): Promise<void> {
  const calendarId = ROOMS.Snooker;
  // Three weeks out and early morning: nowhere near a real booking.
  const start = new Date(Date.now() + 21 * 86_400_000);
  start.setUTCHours(7, 0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);

  hdr(`Write-path check — Snooker, ${start.toISOString().slice(0, 16).replace('T', ' ')}Z`);

  const created = await createEvent(calendarId, {
    summary: `${TEST_EVENT_MARKER} Booking system check`,
    description: `${TEST_EVENT_MARKER}\nAutomated write-path check. Safe to delete.\nPhone: +447700900000`,
    start, end,
  });
  ok(`created ${created.id}`);

  const fetched = await getEvent(calendarId, created.id);
  if (!fetched) throw new Error('event vanished immediately after creation');
  ok(`read back: ${JSON.stringify(fetched.summary)}`);

  const busy = await fetchBusy(calendarId, new Date(start.getTime() - 3_600_000), new Date(end.getTime() + 3_600_000));
  if (!busy.some((b) => b.start.getTime() <= start.getTime() && b.end.getTime() >= end.getTime())) {
    throw new Error('freeBusy does not report the new event — availability would not exclude it');
  }
  ok('freeBusy reports it busy, so availability excludes it');

  try {
    assertDeletableEvent(calendarId, {
      summary: 'A Hirer: Snooker. 1h (Snooker room)',
      description: 'Calendar: Snooker room | Name: A Hirer | Phone: +447700900000',
    });
    throw new Error('GUARD FAILED: an unmarked, real-looking event was deletable');
  } catch (err) {
    if (String(err).includes('GUARD FAILED')) throw err;
    ok('guard refuses to delete an unmarked event');
  }

  await deleteEvent(calendarId, created.id);
  if (await getEvent(calendarId, created.id)) throw new Error('event still present after delete');
  ok('deleted, and confirmed gone');
}

async function cleanup(): Promise<void> {
  hdr('Cleanup — removing [TEST EVENT]s from all three calendars');
  const from = new Date(Date.now() - 90 * 86_400_000);
  const to = new Date(Date.now() + 180 * 86_400_000);
  let removed = 0;

  for (const [name, calendarId] of Object.entries(ROOMS)) {
    const all = await listEvents(calendarId, from, to);
    const mine = all.filter(isTestEvent);
    info(`${name}: ${all.length} events, ${mine.length} marked as test`);
    for (const e of mine) {
      await deleteEvent(calendarId, e.id);
      console.log(`      removed ${e.start.toISOString().slice(0, 16).replace('T', ' ')}  ${e.summary}`);
      removed += 1;
    }
  }
  ok(removed === 0 ? 'nothing to clean' : `removed ${removed} test event(s)`);
}

const mode = process.argv[2] ?? '--check';
try {
  if (mode === '--cleanup') await cleanup();
  else { await check(); await cleanup(); }
  console.log();
} catch (err) {
  console.error(`\n\x1b[31m✗\x1b[0m ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
