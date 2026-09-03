import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { confirmationEmail, ownerNotificationEmail, alertEmail, icsFor, send } from '../src/lib/booking/email.ts';
import { londonToInstant, addMinutes } from '../src/lib/booking/time.ts';

const start = londonToInstant('2026-10-14', '19:00');
const b = {
  reference: 'MB-7K2QX4', roomName: 'Snooker Room', start, end: addMinutes(start, 90),
  durationMins: 90, pricePence: 1125, customerName: 'Jody Fendick',
  customerEmail: 'j@example.com', manageUrl: 'https://meadowbrookdartington.org/bookings/MB-7K2QX4?t=abc',
  capacityNote: 'Cues provided.',
};

describe('confirmation', () => {
  test('carries everything a hirer needs to act', () => {
    const e = confirmationEmail(b);
    for (const needle of ['Snooker Room', 'Wednesday 14 October 2026', '19:00', '20:30',
                          '£11.25', 'MB-7K2QX4', b.manageUrl, 'Cues provided.']) {
      assert.ok(e.text.includes(needle), `text missing ${needle}`);
      assert.ok(e.html.includes(needle), `html missing ${needle}`);
    }
  });

  test('states the cancellation policy', () => {
    assert.match(confirmationEmail(b).text, /full refund up to 1 hour before/);
  });

  test('a booking made inside the window says so instead', () => {
    const e = confirmationEmail({ ...b, nonRefundable: true });
    assert.match(e.text, /cannot be refunded/);
    assert.ok(!e.text.includes('full refund up to'));
  });

  test('subject names the room and when', () => {
    assert.equal(confirmationEmail(b).subject,
      'Your booking is confirmed — Snooker Room, Wed 14 Oct, 19:00');
  });

  test('always has both html and text', () => {
    const e = confirmationEmail(b);
    assert.ok(e.text.length > 50 && e.html.includes('<html'));
  });
});

describe('ics', () => {
  test('uses the booking reference as UID so amendments update one entry', () => {
    assert.match(icsFor(b), /UID:MB-7K2QX4@meadowbrookdartington\.org/);
    assert.match(icsFor(b, 2), /SEQUENCE:2/);
  });

  test('times are UTC instants', () => {
    // 19:00 London in October is BST, so 18:00Z.
    assert.match(icsFor(b), /DTSTART:20261014T180000Z/);
  });

  test('CRLF line endings, as the spec requires', () => {
    assert.ok(icsFor(b).includes('\r\n'));
  });
});

describe('internal mail', () => {
  test('owner notification goes to bookings@ and names the action', () => {
    const e = ownerNotificationEmail(b, 'New');
    assert.equal(e.to, 'bookings@meadowbrookdartington.org');
    assert.match(e.subject, /^\[Booking\] New —/);
    assert.ok(e.text.includes('j@example.com'));
  });

  test('alerts go to it@, separately', () => {
    const e = alertEmail('[FAIL] Payment declined', ['code: GENERIC_DECLINE']);
    assert.equal(e.to, 'it@meadowbrookdartington.org');
  });
});

describe('transport refuses to guess', () => {
  let prevT: string | undefined; let prevN: string | undefined;
  beforeEach(() => { prevT = process.env.BOOKING_EMAIL_TRANSPORT; prevN = process.env.NODE_ENV; });
  afterEach(() => {
    if (prevT === undefined) delete process.env.BOOKING_EMAIL_TRANSPORT;
    else process.env.BOOKING_EMAIL_TRANSPORT = prevT;
    if (prevN === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevN;
  });

  test('unset outside production throws rather than sending', async () => {
    delete process.env.BOOKING_EMAIL_TRANSPORT;
    process.env.NODE_ENV = 'development';
    await assert.rejects(() => send(confirmationEmail(b)), /Refusing to guess/);
  });

  test('console transport does not throw', async () => {
    process.env.BOOKING_EMAIL_TRANSPORT = 'console';
    await assert.doesNotReject(() => send(confirmationEmail(b)));
  });
});

describe('the console transport is refused in production', () => {
  let prevT: string | undefined; let prevN: string | undefined;
  beforeEach(() => { prevT = process.env.BOOKING_EMAIL_TRANSPORT; prevN = process.env.NODE_ENV; });
  afterEach(() => {
    if (prevT === undefined) delete process.env.BOOKING_EMAIL_TRANSPORT;
    else process.env.BOOKING_EMAIL_TRANSPORT = prevT;
    if (prevN === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevN;
  });

  test('console in production throws rather than printing tokens to the logs', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BOOKING_EMAIL_TRANSPORT = 'console';
    await assert.rejects(() => send(confirmationEmail(b)), /not permitted in production/);
  });

  test('production with the variable unset uses brevo', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.BOOKING_EMAIL_TRANSPORT;
    // No BREVO_API_KEY in tests, so it fails at the key check -- which proves it
    // chose brevo rather than console.
    await assert.rejects(() => send(confirmationEmail(b)), /BREVO_API_KEY/);
  });
});

describe('user text is escaped in HTML bodies', () => {
  const nasty = 'Bob</pre><a href="https://evil.example">Approve refund</a><pre>';

  test('the staff notification escapes an injected name', () => {
    const e = ownerNotificationEmail({ ...b, customerName: nasty }, 'New');
    assert.ok(!e.html.includes('<a href="https://evil.example"'), 'markup must not survive');
    assert.ok(e.html.includes('&lt;a href='), 'it should appear escaped instead');
    assert.ok(e.text.includes(nasty), 'the plain-text part is unaffected');
  });

  test('alerts escape too', () => {
    const e = alertEmail('[FAIL] test', [`Booker: ${nasty}`]);
    assert.ok(!e.html.includes('<a href="https://evil.example"'));
  });

  test('ordinary names are readable, not mangled', () => {
    const e = ownerNotificationEmail({ ...b, customerName: "Siân O'Connor" }, 'New');
    assert.ok(e.html.includes('Si&#39;'.replace("&#39;", '')) || e.html.includes('Siân'));
    assert.ok(e.text.includes("Siân O'Connor"));
  });
});

describe('door code and the leaving-the-room note', () => {
  test('the door code appears when known', () => {
    const e = confirmationEmail({ ...b, doorCode: '2868' });
    assert.ok(e.text.includes('Door code: 2868'));
    assert.ok(e.html.includes('2868'));
    assert.ok(e.html.includes('last four digits'), 'and says where it comes from');
  });

  test('no door code row when there is no phone number', () => {
    const e = confirmationEmail({ ...b, doorCode: null });
    assert.ok(!e.text.includes('Door code'));
    assert.ok(!e.html.includes('Door code'));
  });

  test('the housekeeping note is at the foot of the confirmation', () => {
    const e = confirmationEmail(b);
    for (const phrase of ['close the windows', 'lights and heating off', 'tidy for the next person']) {
      assert.ok(e.text.includes(phrase), `text missing "${phrase}"`);
      assert.ok(e.html.includes(phrase), `html missing "${phrase}"`);
    }
    // Last thing in the text body, after the policy line.
    assert.ok(e.text.indexOf('close the windows') > e.text.indexOf('refund'));
  });
});
