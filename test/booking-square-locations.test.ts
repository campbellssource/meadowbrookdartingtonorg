import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLocationMap, squareLocationFor, bookingLocationFor, charge, locationLabel, type SquareConfig,
} from '../src/lib/booking/square.ts';
import { planRefund } from '../src/lib/booking/refunds.ts';
import { byLocationByMonth, chargeLocations } from '../src/lib/booking/reporting.ts';
import type { Booking, Payment } from '../src/lib/booking/store.ts';

// Square pays out per location, so each room charges against its own (`18`).
// The failure that matters is the browser tokenising against one location while
// the server charges another; both resolve through the same functions tested here.

const MAP = '{"snooker-room":"L3JVJABCDB86K","large-room":"LFQHKA4RM1P51","small-room":"L22B8R37R9508"}';
const FALLBACK = 'LT08J54D3THKE';

const cfg = (locationIds: Record<string, string> = parseLocationMap(MAP)): SquareConfig => ({
  accessToken: 'tok', locationId: FALLBACK, locationIds, environment: 'sandbox',
});

/** Swallow the deliberate warnings so the test output stays readable, but count them. */
function quietWarn() {
  const original = console.warn;
  const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => { calls.push(args); };
  return { calls, restore: () => { console.warn = original; } };
}

describe('resolving a room to a Square location', () => {
  test('a mapped room gets its own location', () => {
    assert.equal(squareLocationFor(cfg(), 'snooker-room'), 'L3JVJABCDB86K');
    assert.equal(squareLocationFor(cfg(), 'large-room'), 'LFQHKA4RM1P51');
    assert.equal(squareLocationFor(cfg(), 'small-room'), 'L22B8R37R9508');
  });

  test('an unmapped room falls back', () => {
    assert.equal(squareLocationFor(cfg(), 'new-room'), FALLBACK);
  });

  test('no map at all: everything falls back, silently', () => {
    const w = quietWarn();
    try {
      assert.deepEqual(parseLocationMap(undefined), {});
      assert.deepEqual(parseLocationMap(''), {});
      assert.equal(w.calls.length, 0);
    } finally { w.restore(); }
  });

  test('invalid JSON falls back with a warning, not a crash', () => {
    const w = quietWarn();
    try {
      assert.deepEqual(parseLocationMap('{snooker-room: L3J'), {});
      assert.equal(w.calls.length, 1);
    } finally { w.restore(); }
  });

  test('a non-object falls back with a warning', () => {
    const w = quietWarn();
    try {
      assert.deepEqual(parseLocationMap('["L3JVJABCDB86K"]'), {});
      assert.deepEqual(parseLocationMap('"L3JVJABCDB86K"'), {});
      assert.equal(w.calls.length, 2);
    } finally { w.restore(); }
  });

  test('a bad entry is dropped; the good ones survive', () => {
    const w = quietWarn();
    try {
      assert.deepEqual(
        parseLocationMap('{"snooker-room":"L3JVJABCDB86K","large-room":"","small-room":42}'),
        { 'snooker-room': 'L3JVJABCDB86K' },
      );
      assert.equal(w.calls.length, 2);
    } finally { w.restore(); }
  });
});

describe('the card form and the charge agree', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.PUBLIC_BOOKING_SQUARE_LOCATION_ID = FALLBACK;
    process.env.BOOKING_SQUARE_LOCATION_IDS = MAP;
  });
  afterEach(() => { process.env = { ...saved }; });

  test('page-side resolution matches server-side for every room', () => {
    for (const slug of ['snooker-room', 'large-room', 'small-room', 'unmapped']) {
      assert.equal(bookingLocationFor(slug), squareLocationFor(cfg(), slug), slug);
    }
  });

  test('page-side falls back when the map is unset', () => {
    delete process.env.BOOKING_SQUARE_LOCATION_IDS;
    assert.equal(bookingLocationFor('snooker-room'), FALLBACK);
  });
});

describe('charging', () => {
  const realFetch = globalThis.fetch;
  let sent: Record<string, any>[] = [];
  beforeEach(() => {
    sent = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sent.push(body);
      return new Response(JSON.stringify({
        payment: { id: 'PAY1', status: 'COMPLETED', amount_money: body.amount_money, location_id: body.location_id },
      }), { status: 200 });
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  const input = (roomSlug: string) => ({
    sourceId: 'cnon:x', amountPence: 750, idempotencyKey: 'h1',
    bookingRef: 'MB-1', roomName: 'Room', roomSlug,
  });

  test("sends the room's location_id and records it", async () => {
    const r = await charge(cfg(), input('snooker-room'));
    assert.equal(sent[0].location_id, 'L3JVJABCDB86K');
    assert.equal(r.squareLocationId, 'L3JVJABCDB86K');
  });

  test('an amendment top-up goes to the location of the room it is charged for', async () => {
    // Amendments never change room today, but the charge follows whatever room it
    // is given: a top-up for the Studio lands in the Studio's location.
    await charge(cfg(), input('snooker-room'));
    await charge(cfg(), input('large-room'));
    assert.deepEqual(sent.map((b) => b.location_id), ['L3JVJABCDB86K', 'LFQHKA4RM1P51']);
  });

  test('an unmapped room charges the fallback', async () => {
    const r = await charge(cfg({}), input('snooker-room'));
    assert.equal(sent[0].location_id, FALLBACK);
    assert.equal(r.squareLocationId, FALLBACK);
  });
});

const pay = (p: Partial<Payment> & Pick<Payment, 'kind' | 'amountPence' | 'squarePaymentId'>): Payment =>
  ({ status: 'completed', squareRefundId: null, idempotencyKey: 'k', reason: null, at: null, ...p }) as unknown as Payment;

const booking = (localDate: string, payments: Payment[], extra: Partial<Booking> = {}): Booking =>
  ({ status: 'confirmed', localDate, payments, room: 'snooker-room', ...extra }) as unknown as Booking;

describe('refunds follow the charge', () => {
  test("a refund slice carries the charge's location", () => {
    const plan = planRefund([
      pay({ kind: 'charge', amountPence: 750, squarePaymentId: 'A', squareLocationId: 'L3JVJABCDB86K' }),
      pay({ kind: 'charge', amountPence: 375, squarePaymentId: 'B' }),
    ], 1125);
    assert.ok(plan.ok);
    assert.deepEqual(plan.slices, [
      { squarePaymentId: 'A', amountPence: 750, squareLocationId: 'L3JVJABCDB86K' },
      { squarePaymentId: 'B', amountPence: 375 },
    ]);
  });
});

describe('reporting by location', () => {
  test('nets charges and refunds per location; old entries count as the fallback', () => {
    const rows = [
      { ref: 'a', booking: booking('2026-12-03', [
        pay({ kind: 'charge', amountPence: 750, squarePaymentId: 'A', squareLocationId: 'L3JVJABCDB86K' }),
        pay({ kind: 'refund', amountPence: 250, squarePaymentId: 'A', squareLocationId: 'L3JVJABCDB86K' }),
      ]) },
      { ref: 'b', booking: booking('2026-12-10', [
        pay({ kind: 'charge', amountPence: 1000, squarePaymentId: 'B' }),
      ]) },
      { ref: 'c', booking: booking('2026-12-11', [
        pay({ kind: 'charge', amountPence: 500, squarePaymentId: 'C', squareLocationId: 'L3JVJABCDB86K', status: 'pending' }),
      ]) },
    ];
    assert.deepEqual(byLocationByMonth(rows, FALLBACK), [
      { month: '2026-12', locationId: 'L3JVJABCDB86K', netPence: 500 },
      { month: '2026-12', locationId: FALLBACK, netPence: 1000 },
    ]);
  });

  test('imported Acuity history is its own stream, not the fallback', () => {
    const b = booking('2026-10-01', [pay({ kind: 'charge', amountPence: 900, squarePaymentId: 'acu' })],
      { source: 'acuity' } as Partial<Booking>);
    assert.deepEqual(byLocationByMonth([{ ref: 'x', booking: b }], FALLBACK),
      [{ month: '2026-10', locationId: 'acuity', netPence: 900 }]);
    assert.deepEqual(chargeLocations(b, FALLBACK), ['acuity']);
  });

  test('labels name the rooms that pay into a location', () => {
    const locs = { fallback: FALLBACK, bySlug: parseLocationMap(MAP) };
    const name = (s: string) => ({ 'snooker-room': 'Snooker Room' } as Record<string, string>)[s] ?? s;
    assert.equal(locationLabel('L3JVJABCDB86K', locs, name), 'Snooker Room (L3JVJABCDB86K)');
    assert.equal(locationLabel(FALLBACK, locs, name), `Main (${FALLBACK})`);
    assert.equal(locationLabel('acuity', locs, name), 'Acuity (imported)');
  });
});
