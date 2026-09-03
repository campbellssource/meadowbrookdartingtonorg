// Imports Acuity's booking history into Firestore for reporting. See spec/booking/17.
//
//   npm run booking:import-acuity              dry run -- reads, validates, writes nothing
//   npm run booking:import-acuity -- --commit  writes
//   npm run booking:import-acuity -- --commit --force   overwrites rows already imported
//
// What this deliberately does NOT do:
//
//   - create, patch or delete a calendar event. They already exist, and an event is
//     not an inert record: it is what provisions a door passcode on the building's
//     locks, so writing 862 of them would attempt 862 TTLock codes.
//   - send an email.
//   - issue a magic-link token.
//   - set `isTest`. `npm run booking:cleanup` deletes anything carrying that flag,
//     and this script normally runs on a developer machine where NODE_ENV is unset --
//     which is exactly where that flag would otherwise be added.

import { readFileSync } from 'node:fs';
import { getDb } from '../src/lib/booking/store.ts';
import type { Booking, Payment } from '../src/lib/booking/store.ts';
import { londonToInstant, instantToLocalDate, MINUTE } from '../src/lib/booking/time.ts';
import { Timestamp } from '@google-cloud/firestore';

const CSV = process.argv.find((a) => a.endsWith('.csv')) ?? 'private/acuity-bookings.csv';
const COMMIT = process.argv.includes('--commit');
const FORCE = process.argv.includes('--force');

/** Acuity's calendar names, which are the only reliable room signal in the export. */
const ROOM_BY_CALENDAR: Record<string, string> = {
  'Snooker room': 'snooker-room',
  'Studio - Large room': 'large-room',
  'Lounge - Small room': 'small-room',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 6, 2024 13:00" -> instant, resolved in London. */
export function parseAcuityTime(raw: string): Date {
  const m = raw.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`unparseable time: ${raw}`);
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) throw new Error(`unknown month: ${raw}`);
  const date = `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const time = `${m[4].padStart(2, '0')}:${m[5]}`;
  // Wall time in Europe/London, never UTC. Parsing these as UTC would move a year of
  // bookings by an hour across every BST period, silently.
  return londonToInstant(date as `${number}-${number}-${number}`, time as `${number}:${number}`);
}

export function poundsToPence(raw: string): number {
  const n = Number.parseFloat((raw ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Minimal CSV reader: quoted fields, embedded commas, doubled quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ''));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export interface Built { ref: string; booking: Booking }

export function buildBooking(r: Record<string, string>): Built {
  const room = ROOM_BY_CALENDAR[r['Calendar']];
  if (!room) throw new Error(`unmapped calendar: ${r['Calendar']}`);

  const start = parseAcuityTime(r['Start Time']);
  const end = parseAcuityTime(r['End Time']);
  const durationMins = Math.round((end.getTime() - start.getTime()) / MINUTE);
  if (durationMins <= 0) throw new Error(`non-positive duration for ${r['Appointment ID']}`);

  const pricePence = poundsToPence(r['Appointment Price']);
  const paidOnlinePence = poundsToPence(r['Amount Paid Online']);
  const scheduled = r['Date Scheduled'] ? new Date(`${r['Date Scheduled']}T00:00:00Z`) : start;
  const at = Timestamp.fromDate(Number.isNaN(scheduled.getTime()) ? start : scheduled);

  // One synthetic completed charge, because reporting sums the ledger rather than
  // pricePence -- an empty payments array would report every historical booking as
  // £0 and make the whole backfill pointless. squarePaymentId is empty on purpose:
  // reconciliation skips entries without one, so it never chases a payment that was
  // never in our Square account.
  const payment: Payment = {
    at,
    kind: 'charge',
    amountPence: pricePence,
    squarePaymentId: '',
    squareRefundId: null,
    idempotencyKey: `acuity:${r['Appointment ID']}`,
    status: 'completed',
    reason: 'acuity-import',
  };

  const name = `${r['First Name'] ?? ''} ${r['Last Name'] ?? ''}`.trim();
  const booking: Booking = {
    room,
    source: 'acuity',
    acuity: {
      appointmentId: r['Appointment ID'],
      paidOnlinePence,
      paid: (r['Paid?'] ?? '').toLowerCase() === 'yes',
      type: r['Type'] ?? '',
    },
    status: 'confirmed',
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
    localDate: instantToLocalDate(start),
    durationMins,
    pricePence,
    paidPence: pricePence,
    customer: {
      name: name || 'Unknown',
      email: (r['Email'] ?? '').toLowerCase(),
      ...(r['Phone'] ? { phone: r['Phone'] } : {}),
      ...(r['Notes'] ? { notes: r['Notes'] } : {}),
    },
    calendarEventId: null,
    payments: [payment],
    seriesId: null,
    termsVersion: 'acuity',
    createdAt: at,
    updatedAt: Timestamp.now(),
    history: [{ at, action: 'imported from Acuity', actor: 'system' }],
  };
  return { ref: `ACU-${r['Appointment ID']}`, booking };
}

async function main(): Promise<void> {
  const rows = parseCsv(readFileSync(CSV, 'utf8'));
  const skipped = rows.filter((r) => !ROOM_BY_CALENDAR[r['Calendar']]);
  const usable = rows.filter((r) => ROOM_BY_CALENDAR[r['Calendar']]);

  console.log(`\n  ${CSV}: ${rows.length} rows`);
  console.log(`  ${skipped.length} skipped (no room calendar -- donations and event entries):`);
  for (const [type, n] of Object.entries(
    skipped.reduce<Record<string, number>>((a, r) => ({ ...a, [r['Type']]: (a[r['Type']] ?? 0) + 1 }), {}),
  )) console.log(`      ${String(n).padStart(3)}  ${type.slice(0, 56)}`);

  const built: Built[] = [];
  const failed: string[] = [];
  for (const r of usable) {
    try { built.push(buildBooking(r)); }
    catch (err) { failed.push(`${r['Appointment ID']}: ${(err as Error).message}`); }
  }

  if (failed.length) {
    console.log(`\n  ${failed.length} row(s) could not be built:`);
    for (const f of failed.slice(0, 10)) console.log(`      ${f}`);
    console.log('\n  Refusing to import a partial set. Fix these first.');
    process.exit(1);
  }

  const byRoom = built.reduce<Record<string, { n: number; pence: number; mins: number }>>((a, b) => {
    const e = a[b.booking.room] ?? { n: 0, pence: 0, mins: 0 };
    return { ...a, [b.booking.room]: {
      n: e.n + 1, pence: e.pence + b.booking.pricePence, mins: e.mins + b.booking.durationMins } };
  }, {});
  const dates = built.map((b) => b.booking.localDate).sort();
  console.log(`\n  ${built.length} bookings to import, ${dates[0]} → ${dates[dates.length - 1]}`);
  for (const [room, e] of Object.entries(byRoom)) {
    console.log(`      ${room.padEnd(13)} ${String(e.n).padStart(4)} bookings  `
      + `£${(e.pence / 100).toFixed(2).padStart(9)}  ${(e.mins / 60).toFixed(1).padStart(7)} hours`);
  }
  const total = built.reduce((s, b) => s + b.booking.pricePence, 0);
  console.log(`      ${'TOTAL'.padEnd(13)} ${String(built.length).padStart(4)} bookings  £${(total / 100).toFixed(2).padStart(9)}`);

  const ids = new Set(built.map((b) => b.ref));
  if (ids.size !== built.length) {
    console.log(`\n  Duplicate references — ${built.length - ids.size}. Refusing.`);
    process.exit(1);
  }

  const db = await getDb();

  // Existing bookings predate the field; stamp them so `source` is never absent.
  const existing = await db.collection('bookings').get();
  const unstamped = existing.docs.filter((d) => !(d.data() as Booking).source);
  const alreadyImported = new Set(
    existing.docs.filter((d) => (d.data() as Booking).source === 'acuity').map((d) => d.id),
  );
  const fresh = built.filter((b) => !alreadyImported.has(b.ref));
  console.log(`\n  Firestore holds ${existing.size} bookings; ${alreadyImported.size} already imported.`);
  console.log(`  ${fresh.length} new, ${built.length - fresh.length} already present`
    + `${FORCE ? ' (will be overwritten: --force)' : ' (skipped)'}`);
  console.log(`  ${unstamped.length} existing booking(s) will be stamped source: 'meadowbrook'`);

  if (!COMMIT) {
    console.log('\n  DRY RUN — nothing written. Re-run with --commit.\n');
    return;
  }

  const toWrite = FORCE ? built : fresh;
  let written = 0;
  for (let i = 0; i < toWrite.length; i += 400) {
    const batch = db.batch();
    for (const b of toWrite.slice(i, i + 400)) {
      batch.set(db.collection('bookings').doc(b.ref), b.booking);
    }
    await batch.commit();
    written += Math.min(400, toWrite.length - i);
    console.log(`      committed ${written}/${toWrite.length}`);
  }

  for (let i = 0; i < unstamped.length; i += 400) {
    const batch = db.batch();
    for (const d of unstamped.slice(i, i + 400)) batch.update(d.ref, { source: 'meadowbrook' });
    await batch.commit();
  }

  console.log(`\n  Imported ${written} booking(s); stamped ${unstamped.length} existing.\n`);
}

if (process.argv[1]?.includes('import-acuity')) await main();
