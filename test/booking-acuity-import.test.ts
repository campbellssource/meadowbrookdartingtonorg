import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAcuityTime, poundsToPence, parseCsv, buildBooking } from '../scripts/import-acuity.ts';

// Importing Acuity's history for reporting (spec/booking/17). The dangerous parts are
// not the writing but the reading: a mis-parsed time moves a year of bookings by an
// hour without complaint, and a row that is not a room booking quietly becomes room
// revenue.

const row = (over: Record<string, string> = {}) => ({
  'Start Time': 'October 6, 2024 13:00',
  'End Time': 'October 6, 2024 15:00',
  'Timezone': 'Europe/London',
  'First Name': 'Jody', 'Last Name': 'Fendick',
  'Phone': '07700900000', 'Email': 'Jody@Example.com',
  'Type': 'Snooker room. 2h', 'Calendar': 'Snooker room',
  'Appointment Price': '15.00', 'Paid?': 'yes', 'Amount Paid Online': '15.00',
  'Date Scheduled': '2024-10-05', 'Appointment ID': '1234567',
  ...over,
});

describe('parsing Acuity times', () => {
  // The whole point. Acuity exports wall time with Timezone: Europe/London on every
  // row; treating it as UTC would shift every summer booking by an hour.
  test('a summer time is resolved as BST, not UTC', () => {
    assert.equal(parseAcuityTime('October 6, 2024 13:00').toISOString(), '2024-10-06T12:00:00.000Z');
  });
  test('a winter time is resolved as GMT', () => {
    assert.equal(parseAcuityTime('December 6, 2024 13:00').toISOString(), '2024-12-06T13:00:00.000Z');
  });
  test('the day the clocks go back', () => {
    assert.equal(parseAcuityTime('October 27, 2024 13:00').toISOString(), '2024-10-27T13:00:00.000Z');
    assert.equal(parseAcuityTime('October 26, 2024 13:00').toISOString(), '2024-10-26T12:00:00.000Z');
  });
  test('single-digit days and midnight parse', () => {
    assert.equal(parseAcuityTime('July 4, 2025 09:15').toISOString(), '2025-07-04T08:15:00.000Z');
    assert.equal(parseAcuityTime('January 1, 2025 00:00').toISOString(), '2025-01-01T00:00:00.000Z');
  });
  test('anything unexpected throws rather than guessing', () => {
    assert.throws(() => parseAcuityTime('06/10/2024 13:00'));
    assert.throws(() => parseAcuityTime('Octobre 6, 2024 13:00'));
  });
});

describe('money', () => {
  test('pounds become pence without floating-point drift', () => {
    assert.equal(poundsToPence('15.00'), 1500);
    assert.equal(poundsToPence('11.25'), 1125);
    assert.equal(poundsToPence('18.75'), 1875);
    assert.equal(poundsToPence('7.50'), 750);
    assert.equal(poundsToPence('0.00'), 0);
  });
  test('blanks and junk are zero, not NaN', () => {
    assert.equal(poundsToPence(''), 0);
    assert.equal(poundsToPence('n/a'), 0);
  });
});

describe('CSV reading', () => {
  test('quoted fields with commas survive', () => {
    const rows = parseCsv('a,b\n"one, two",three\n');
    assert.deepEqual(rows, [{ a: 'one, two', b: 'three' }]);
  });
  test('doubled quotes are one quote', () => {
    assert.deepEqual(parseCsv('a\n"He said ""hi"""\n'), [{ a: 'He said "hi"' }]);
  });
  test('a byte-order mark does not corrupt the first column name', () => {
    assert.deepEqual(parseCsv('﻿a,b\n1,2\n'), [{ a: '1', b: '2' }]);
  });
});

describe('building a booking', () => {
  test('the reference comes from the Acuity id, so a re-run cannot duplicate', () => {
    assert.equal(buildBooking(row()).ref, 'ACU-1234567');
  });

  test('the calendar decides the room', () => {
    assert.equal(buildBooking(row()).booking.room, 'snooker-room');
    assert.equal(buildBooking(row({ Calendar: 'Studio - Large room' })).booking.room, 'large-room');
    assert.equal(buildBooking(row({ Calendar: 'Lounge - Small room' })).booking.room, 'small-room');
  });

  test('a row with no room calendar is refused outright', () => {
    assert.throws(() => buildBooking(row({ Calendar: '', Type: '£10 Donation' })),
      /unmapped calendar/);
  });

  test('it is flagged as imported, which is what stops the rest of the system acting on it', () => {
    assert.equal(buildBooking(row()).booking.source, 'acuity');
  });

  test('no calendar event is referenced — writing one would provision a door code', () => {
    assert.equal(buildBooking(row()).booking.calendarEventId, null);
  });

  // booking:cleanup deletes anything flagged isTest, and this script normally runs on
  // a machine where NODE_ENV is unset.
  test('it is never marked as a test booking', () => {
    assert.ok(!('isTest' in buildBooking(row()).booking));
  });

  test('the ledger carries the price, because reporting sums payments not pricePence', () => {
    const { booking } = buildBooking(row());
    assert.equal(booking.payments.length, 1);
    assert.equal(booking.payments[0].amountPence, 1500);
    assert.equal(booking.payments[0].status, 'completed');
    assert.equal(booking.paidPence, 1500);
  });

  test('the ledger entry has no Square payment id, so reconciliation ignores it', () => {
    assert.equal(buildBooking(row()).booking.payments[0].squarePaymentId, '');
  });

  // The DRA's call on 3 Sep 2026: include them, and do not fret about income.
  test('an unpaid booking still counts, with what Acuity collected recorded separately', () => {
    const { booking } = buildBooking(row({ 'Paid?': 'no', 'Amount Paid Online': '0.00' }));
    assert.equal(booking.pricePence, 1500);
    assert.equal(booking.paidPence, 1500);
    assert.equal(booking.acuity?.paidOnlinePence, 0);
    assert.equal(booking.acuity?.paid, false);
  });

  test('duration comes from the times, and the local date from the start', () => {
    const { booking } = buildBooking(row());
    assert.equal(booking.durationMins, 120);
    assert.equal(booking.localDate, '2024-10-06');
  });

  test('a booking that ends before it starts is refused', () => {
    assert.throws(() => buildBooking(row({ 'End Time': 'October 6, 2024 12:00' })),
      /non-positive duration/);
  });

  test('email is lowercased and a missing phone is simply absent', () => {
    const { booking } = buildBooking(row({ Phone: '' }));
    assert.equal(booking.customer.email, 'jody@example.com');
    assert.ok(!('phone' in booking.customer));
  });

  test('a nameless row still imports rather than failing the whole run', () => {
    assert.equal(buildBooking(row({ 'First Name': '', 'Last Name': '' })).booking.customer.name, 'Unknown');
  });
});
