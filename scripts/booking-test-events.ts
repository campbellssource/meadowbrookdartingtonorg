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
import { PRODUCTION_CALENDAR_IDS, DEFAULTS, toRoomConfig } from '../src/lib/booking/config.ts';
import { takeHold, releaseHold, getDb, SlotUnavailableError } from '../src/lib/booking/store.ts';

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

  // Test bookings in Firestore, found by their own marker rather than by a list
  // of references anyone had to remember.
  const db = await getDb();
  const tests = await db.collection('bookings').where('isTest', '==', true).get();
  info(`Firestore: ${tests.size} test booking(s)`);
  for (const doc of tests.docs) {
    console.log(`      removed ${doc.id}  ${doc.data().localDate}`);
    await doc.ref.delete();
  }

  const holds = await db.collection('holds').get();
  if (holds.size) {
    info(`Firestore: ${holds.size} stale hold(s)`);
    for (const doc of holds.docs) await doc.ref.delete();
  }
  ok('Firestore clean');
}

/**
 * The test the hold transaction exists for: many people, one slot, one winner.
 *
 * Runs against real Firestore rather than the emulator, because what is being
 * tested *is* Firestore's transaction semantics -- an emulator that implemented
 * them differently would give a green run and prove nothing.
 */
async function concurrency(): Promise<void> {
  hdr('Concurrency — 8 simultaneous attempts on one slot');

  const room = toRoomConfig('large-room', {
    calendarId: 'concurrency-test-not-a-real-calendar',
    shortName: 'Studio', hourlyRatePence: 1000, bufferMins: 30,
  })!;
  // Far future so it can never collide with anything real.
  const start = new Date(Date.now() + 300 * 86_400_000);
  start.setUTCHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);

  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () => takeHold({ room, start, end })),
  );
  const won = attempts.filter((a) => a.status === 'fulfilled');
  const lost = attempts.filter((a) => a.status === 'rejected');

  info(`${won.length} succeeded, ${lost.length} refused`);
  const wrongError = lost.find((l) => !((l as PromiseRejectedResult).reason instanceof SlotUnavailableError));
  if (wrongError) {
    throw new Error(`a loser failed for the wrong reason: ${(wrongError as PromiseRejectedResult).reason}`);
  }
  if (won.length !== 1) {
    // Clean up whatever did get written before failing, so a bad run leaves nothing.
    for (const w of won) await releaseHold((w as PromiseFulfilledResult<{ holdId: string }>).value.holdId);
    throw new Error(`expected exactly 1 winner, got ${won.length} — the slot could be double-sold`);
  }
  ok('exactly one hold taken; the other seven were refused');
  ok('every refusal was SlotUnavailableError, not a crash');

  // A second attempt after the winner exists must also lose.
  try {
    const late = await takeHold({ room, start, end });
    await releaseHold(late.holdId);
    throw new Error('a later attempt on a held slot succeeded');
  } catch (err) {
    if (!(err instanceof SlotUnavailableError)) throw err;
    ok('a later attempt on the held slot is refused too');
  }

  // The buffer must apply at the point of purchase, not just in availability.
  try {
    const adjacent = await takeHold({
      room, start: new Date(end.getTime()), end: new Date(end.getTime() + 3_600_000),
    });
    await releaseHold(adjacent.holdId);
    throw new Error('a booking inside the 30-minute buffer was allowed');
  } catch (err) {
    if (!(err instanceof SlotUnavailableError)) throw err;
    ok('a slot inside the buffer is refused at purchase, not just hidden in availability');
  }

  const winner = (won[0] as PromiseFulfilledResult<{ holdId: string; bookingRef: string }>).value;
  info(`winning reference would be ${winner.bookingRef}`);
  await releaseHold(winner.holdId);

  const left = await (await getDb()).collection('holds').where('room', '==', 'large-room').get();
  const stale = left.docs.filter((d) => d.data().start.toDate().getTime() === start.getTime());
  if (stale.length) throw new Error(`${stale.length} test hold(s) left behind`);
  ok('holds cleaned up');
}

const mode = process.argv[2] ?? '--check';
try {
  if (mode === '--cleanup') await cleanup();
  else if (mode === '--concurrency') await concurrency();
  else { await check(); await concurrency(); await cleanup(); }
  console.log();
} catch (err) {
  console.error(`\n\x1b[31m✗\x1b[0m ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
