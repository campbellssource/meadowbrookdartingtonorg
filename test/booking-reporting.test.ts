import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { headline, byRoomByMonth, occupancy, leadTimes, repeatBookers } from '../src/lib/booking/reporting.ts';
import type { Row } from '../src/lib/booking/reporting.ts';

const ts = (iso: string) => ({ toDate: () => new Date(iso) });
const mk = (over: Partial<any> = {}): Row => ({
  ref: over.ref ?? 'MB-AAAAAA',
  booking: {
    room: 'snooker-room', status: 'confirmed',
    start: ts('2026-09-10T14:00:00Z'), end: ts('2026-09-10T15:00:00Z'),
    localDate: '2026-09-10', durationMins: 60, pricePence: 750, paidPence: 750,
    customer: { name: 'A', email: 'a@example.com' },
    calendarEventId: 'e', seriesId: null, termsVersion: '1',
    createdAt: ts('2026-09-01T10:00:00Z'), updatedAt: ts('2026-09-01T10:00:00Z'),
    history: [],
    payments: [{ kind: 'charge', amountPence: 750, status: 'completed', reason: 'initial' }],
    ...over.booking,
  } as any,
});

describe('headline', () => {
  test('gross, refunded and net', () => {
    const rows = [
      mk(),
      mk({ ref: 'B', booking: { payments: [
        { kind: 'charge', amountPence: 2000, status: 'completed' },
        { kind: 'refund', amountPence: 500, status: 'completed' },
      ] } }),
    ];
    const h = headline(rows);
    assert.equal(h.grossPence, 2750);
    assert.equal(h.refundedPence, 500);
    assert.equal(h.netPence, 2250);
  });

  test('pending money is counted as unsettled, not as revenue', () => {
    // Square returns refunds as pending; counting them either way would be wrong
    // until the webhook settles them, so they are reported separately.
    const rows = [mk({ booking: { payments: [
      { kind: 'charge', amountPence: 1000, status: 'completed' },
      { kind: 'refund', amountPence: 1000, status: 'pending' },
    ] } })];
    const h = headline(rows);
    assert.equal(h.netPence, 1000, 'a pending refund has not reduced revenue yet');
    assert.equal(h.unsettledPence, 1000, 'but it is flagged as unsettled');
  });

  test('orphaned bookings are excluded entirely', () => {
    const rows = [mk(), mk({ ref: 'O', booking: { status: 'orphaned' } })];
    assert.equal(headline(rows).bookingCount, 1);
  });

  test('cancellation rate', () => {
    const rows = [mk(), mk({ ref: 'C', booking: { status: 'cancelled' } })];
    const h = headline(rows);
    assert.equal(h.cancelledCount, 1);
    assert.equal(h.cancellationRate, 0.5);
  });

  test('empty period does not divide by zero', () => {
    const h = headline([]);
    assert.equal(h.cancellationRate, 0);
    assert.equal(h.averageValuePence, 0);
  });
});

describe('breakdowns', () => {
  test('net by room by month', () => {
    const rows = [
      mk(),
      mk({ ref: 'B', booking: { room: 'large-room', localDate: '2026-09-12',
        payments: [{ kind: 'charge', amountPence: 2000, status: 'completed' }] } }),
      mk({ ref: 'C', booking: { localDate: '2026-10-01' } }),
    ];
    const out = byRoomByMonth(rows);
    assert.deepEqual(out, [
      { month: '2026-09', room: 'large-room', netPence: 2000 },
      { month: '2026-09', room: 'snooker-room', netPence: 750 },
      { month: '2026-10', room: 'snooker-room', netPence: 750 },
    ]);
  });

  test('occupancy is booked hours over opening hours', () => {
    // One 1-hour booking in September, 15 opening hours a day, 30 days = 450.
    const out = occupancy([mk()], 15);
    assert.equal(out[0].bookedHours, 1);
    assert.equal(out[0].availableHours, 450);
    assert.ok(Math.abs(out[0].rate - 1 / 450) < 1e-9);
  });

  test('cancelled bookings do not count as occupancy', () => {
    assert.deepEqual(occupancy([mk({ booking: { status: 'cancelled' } })], 15), []);
  });

  test('lead times bucket correctly', () => {
    const rows = [
      mk({ booking: { createdAt: ts('2026-09-10T09:00:00Z') } }),          // same day
      mk({ ref: 'B', booking: { createdAt: ts('2026-09-09T09:00:00Z') } }), // 1-2 days
      mk({ ref: 'C', booking: { createdAt: ts('2026-07-01T09:00:00Z') } }), // over a month
    ];
    const out = Object.fromEntries(leadTimes(rows).map((b) => [b.bucket, b.count]));
    assert.equal(out['Same day'], 1);
    assert.equal(out['1–2 days'], 1);
    assert.equal(out['Over a month'], 1);
  });

  test('repeat bookers and their revenue share', () => {
    const rows = [
      mk(), mk({ ref: 'B' }),  // same email twice
      mk({ ref: 'C', booking: { customer: { name: 'B', email: 'b@example.com' },
        payments: [{ kind: 'charge', amountPence: 1500, status: 'completed' }] } }),
    ];
    const r = repeatBookers(rows);
    assert.equal(r.uniqueBookers, 2);
    assert.equal(r.repeatBookers, 1);
    // a@ contributed 1500 of 3000.
    assert.ok(Math.abs(r.repeatRevenueShare - 0.5) < 1e-9);
  });
});
