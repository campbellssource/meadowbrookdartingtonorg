import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  splitName, newsletterListId, subscribeToNewsletter, NEWSLETTER_CONSENT_TEXT,
} from '../src/lib/booking/newsletter.ts';

// Adding a hirer to the Brevo newsletter list when they tick the box. The rules that
// matter here are consent rules, not delivery rules: a marketing list you were put on
// without asking, or put back on after unsubscribing, is the kind of mistake that is
// both unlawful and impossible to take back.

const realFetch = globalThis.fetch;
let calls: { url: string; method: string; body: any }[] = [];

/** Stands in for Brevo. `routes` maps "METHOD /path" to a [status, body] pair. */
function stubBrevo(routes: Record<string, [number, unknown]>) {
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = String(url).replace('https://api.brevo.com/v3', '');
    const method = init.method ?? 'GET';
    calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null });
    const hit = routes[`${method} ${u}`];
    if (!hit) return new Response('no stub', { status: 500 });
    // 204/205/304 must not carry a body, which is what Brevo actually returns when
    // it adds a contact to a list.
    const bodyless = [204, 205, 304].includes(hit[0]);
    return new Response(bodyless ? null : JSON.stringify(hit[1]), { status: hit[0] });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  process.env.BREVO_API_KEY = 'test-key';
  process.env.BOOKING_EMAIL_TRANSPORT = 'brevo';
  delete process.env.BOOKING_NEWSLETTER_LIST_ID;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('newsletter list id', () => {
  test('defaults to 2, the DRA\'s "newsletter" list', () => {
    assert.equal(newsletterListId(), 2);
  });
  test('an override is honoured', () => {
    process.env.BOOKING_NEWSLETTER_LIST_ID = '7';
    assert.equal(newsletterListId(), 7);
  });
  test('nonsense falls back rather than sending NaN to Brevo', () => {
    process.env.BOOKING_NEWSLETTER_LIST_ID = 'newsletter';
    assert.equal(newsletterListId(), 2);
  });
});

describe('splitting a name for Brevo', () => {
  test('one word is a first name', () => {
    assert.deepEqual(splitName('Cher'), { firstName: 'Cher', lastName: '' });
  });
  test('two words split as expected', () => {
    assert.deepEqual(splitName('Jody Fendick'), { firstName: 'Jody', lastName: 'Fendick' });
  });
  test('the last word is the surname, however many names precede it', () => {
    assert.deepEqual(splitName('Karl Morgan Pritchard'),
      { firstName: 'Karl Morgan', lastName: 'Pritchard' });
  });
  test('empty and messy input do not throw', () => {
    assert.deepEqual(splitName('   '), { firstName: '', lastName: '' });
    assert.deepEqual(splitName('  Siân   O’Connor '), { firstName: 'Siân', lastName: 'O’Connor' });
  });
});

describe('subscribing', () => {
  test('an unknown address is created on the list', async () => {
    stubBrevo({ 'GET /contacts/new%40example.com': [404, {}], 'POST /contacts': [201, { id: 1 }] });
    assert.equal(await subscribeToNewsletter({ email: 'new@example.com', name: 'Jody Fendick' }), 'created');
    const create = calls.find((c) => c.method === 'POST');
    assert.deepEqual(create?.body.listIds, [2]);
    assert.equal(create?.body.attributes.FIRSTNAME, 'Jody');
  });

  // The single most important line in this file. Sending emailBlacklisted:false would
  // put someone who had unsubscribed back onto the list.
  test('creating a contact never clears an unsubscribe', async () => {
    stubBrevo({ 'GET /contacts/new%40example.com': [404, {}], 'POST /contacts': [201, {}] });
    await subscribeToNewsletter({ email: 'new@example.com', name: 'A B' });
    const create = calls.find((c) => c.method === 'POST');
    assert.ok(!('emailBlacklisted' in (create?.body ?? {})),
      'emailBlacklisted must never be sent -- it would resubscribe an opted-out contact');
  });

  test('an existing contact already on the list is left completely alone', async () => {
    stubBrevo({ 'GET /contacts/old%40example.com': [200, { listIds: [2, 5] }] });
    assert.equal(await subscribeToNewsletter({ email: 'old@example.com', name: 'A B' }), 'already-subscribed');
    assert.equal(calls.filter((c) => c.method === 'POST').length, 0,
      'no write should happen for someone already subscribed');
  });

  test('an existing contact not on the list is added, without touching their details', async () => {
    stubBrevo({
      'GET /contacts/known%40example.com': [200, { listIds: [5] }],
      'POST /contacts/lists/2/contacts/add': [204, {}],
    });
    assert.equal(await subscribeToNewsletter({ email: 'known@example.com', name: 'New Name' }), 'added');
    const write = calls.find((c) => c.method === 'POST');
    assert.deepEqual(write?.body, { emails: ['known@example.com'] },
      'adding to a list must not overwrite the attributes of a long-standing contact');
  });

  test('a race that says "already in list" is a success, not an error', async () => {
    stubBrevo({
      'GET /contacts/x%40example.com': [200, { listIds: [] }],
      'POST /contacts/lists/2/contacts/add': [400, { message: 'Contact already in list' }],
    });
    assert.equal(await subscribeToNewsletter({ email: 'x@example.com', name: 'A B' }), 'already-subscribed');
  });

  test('a real Brevo failure throws, so the caller can alert', async () => {
    stubBrevo({ 'GET /contacts/x%40example.com': [500, { message: 'boom' }] });
    await assert.rejects(() => subscribeToNewsletter({ email: 'x@example.com', name: 'A B' }));
  });

  test('local development never touches the real list', async () => {
    process.env.BOOKING_EMAIL_TRANSPORT = 'console';
    stubBrevo({});
    assert.equal(await subscribeToNewsletter({ email: 'x@example.com', name: 'A B' }), 'skipped');
    assert.equal(calls.length, 0, 'no HTTP call may be made with the console transport');
  });
});

describe('consent', () => {
  test('the form shows the exact wording that gets recorded', () => {
    const widget = readFileSync('src/components/BookingWidget.astro', 'utf8');
    const api = readFileSync('src/pages/api/booking/create.ts', 'utf8');
    assert.match(widget, /NEWSLETTER_CONSENT_TEXT/,
      'the form must render the shared wording, not its own copy');
    assert.match(api, /newsletterWording: NEWSLETTER_CONSENT_TEXT/,
      'the booking must record the same wording the form showed');
  });

  test('the checkbox is never pre-ticked', () => {
    const widget = readFileSync('src/components/BookingWidget.astro', 'utf8');
    const box = widget.match(/<input type="checkbox" id=\{`\$\{wid\}-newsletter`\}[^>]*>/)?.[0] ?? '';
    assert.ok(box, 'the newsletter checkbox is missing');
    assert.ok(!/checked/.test(box), 'a pre-ticked box is not consent under UK GDPR');
  });

  test('only a strict true counts as opting in', () => {
    const api = readFileSync('src/pages/api/booking/create.ts', 'utf8');
    assert.match(api, /newsletterOptIn\s*=\s*payload\.newsletterOptIn === true/,
      'a truthy check would opt people in on any stray value');
  });

  test('the wording says what it does and how to stop', () => {
    assert.match(NEWSLETTER_CONSENT_TEXT, /unsubscribe/i);
    assert.match(NEWSLETTER_CONSENT_TEXT, /Meadowbrook/);
  });
});
