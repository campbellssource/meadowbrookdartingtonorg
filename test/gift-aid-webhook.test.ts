import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { processDonationEvent, verifySquareSignature } from '../src/lib/gift-aid/webhook.ts';
import type { WebhookDeps, SquarePayment, SquareRefund } from '../src/lib/gift-aid/webhook.ts';
import { validateDeclaration } from '../src/lib/gift-aid/validate.ts';
import { renderDeclaration } from '../src/lib/gift-aid/declaration.ts';
import { newIntentId } from '../src/lib/gift-aid/ids.ts';
import type { DonationIntent } from '../src/lib/gift-aid/types.ts';
import { memoryStore } from './gift-aid-memory-store.ts';

// The path from "Square says a payment happened" to a donation record. The rules
// under test: only a COMPLETED payment read back from Square records anything; only
// payments this site started as donations count; duplicates and retries record once;
// refunds mark the donation Refunded and queue the sheet's Status cell.

const NOW = new Date('2026-10-25T10:00:00Z');

function harness() {
  const mem = memoryStore();
  const payments = new Map<string, SquarePayment>();
  const refunds = new Map<string, SquareRefund>();
  const recorded: string[] = [];
  const refunded: string[] = [];
  const deps: WebhookDeps = {
    store: mem.store,
    getPayment: async (id) => payments.get(id) ?? null,
    getRefund: async (id) => refunds.get(id) ?? null,
    afterRecorded: async ({ donation }) => { recorded.push(donation.id); },
    afterRefunded: async (d) => { refunded.push(d.id); },
    now: () => NOW,
  };
  return { mem, payments, refunds, recorded, refunded, deps };
}

async function intentFor(h: ReturnType<typeof harness>, opts: { giftAid: boolean; pence?: number }): Promise<DonationIntent> {
  const pence = opts.pence ?? 2500;
  let giftAid = null;
  if (opts.giftAid) {
    const r = validateDeclaration({
      optIn: true, firstName: 'Jane', lastName: 'Smith', houseNameOrNumber: '12', addressLine: 'Example Road',
      town: 'Dartington', postcode: 'TQ9 6EJ', email: 'jane@example.com', scope: 'Enduring',
    }, { method: 'Online', now: NOW });
    assert.ok(r.ok);
    giftAid = (r as { value: any }).value;
  }
  const intent: DonationIntent = {
    id: newIntentId(), amountPence: pence, campaign: 'Pool appeal', name: 'Jane Smith', email: 'jane@example.com',
    giftAid, wordingText: giftAid ? renderDeclaration('Enduring', pence) : null,
    status: 'pending', donationId: null, declarationId: null, createdAt: NOW, expiresAt: new Date(NOW.getTime() + 864e5),
  };
  await h.mem.store.createIntent(intent);
  return intent;
}

const paymentEvent = (type: string, id: string) => ({ type, event_id: `ev-${Math.random()}`, data: { object: { payment: { id } } } });
const refundEvent = (type: string, id: string) => ({ type, event_id: `ev-${Math.random()}`, data: { object: { refund: { id } } } });

describe('recording a paid donation', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  test('a completed payment for our intent records a donation and its declaration', async () => {
    const intent = await intentFor(h, { giftAid: true });
    h.payments.set('pay-1', { id: 'pay-1', status: 'COMPLETED', reference_id: intent.id, amount_money: { amount: 2500 }, updated_at: '2026-10-25T09:59:00Z' });

    assert.equal(await processDonationEvent(paymentEvent('payment.updated', 'pay-1'), h.deps), 'recorded');
    assert.equal(h.mem.donations.size, 1);
    assert.equal(h.mem.declarations.size, 1);

    const donation = [...h.mem.donations.values()][0];
    const declaration = [...h.mem.declarations.values()][0];
    assert.equal(donation.declarationId, declaration.id);
    assert.equal(donation.amountPence, 2500);
    assert.equal(donation.method, 'Online');
    assert.equal(donation.source, 'Web');
    assert.equal(donation.viaPlatform, false);
    assert.equal(donation.status, 'Received');
    assert.equal(donation.campaign, 'Pool appeal');
    assert.equal(donation.receivedOn, '2026-10-25');
    assert.equal(donation.squarePaymentId, 'pay-1');
    assert.equal(declaration.method, 'Online');
    assert.equal(declaration.enteredBy, 'website');
    assert.equal(declaration.wordingVersion, 'v1');
    assert.match(declaration.wordingText, /my donation of £25 and any donations/);
    assert.equal(declaration.lastGiftOn, '2026-10-25');
    assert.equal(declaration.retainUntil, '2033-03-31');
    assert.equal(h.mem.intents.get(intent.id)!.status, 'recorded');
    assert.deepEqual(h.recorded, [donation.id], 'email and sheet run once, after the commit');
  });

  test('without Gift Aid, a donation is recorded with no declaration', async () => {
    const intent = await intentFor(h, { giftAid: false });
    h.payments.set('pay-2', { id: 'pay-2', status: 'COMPLETED', reference_id: intent.id, amount_money: { amount: 2500 } });
    assert.equal(await processDonationEvent(paymentEvent('payment.created', 'pay-2'), h.deps), 'recorded');
    assert.equal(h.mem.declarations.size, 0);
    assert.equal([...h.mem.donations.values()][0].declarationId, null);
  });

  test('the same webhook twice records once', async () => {
    const intent = await intentFor(h, { giftAid: true });
    h.payments.set('pay-3', { id: 'pay-3', status: 'COMPLETED', reference_id: intent.id, amount_money: { amount: 2500 } });
    const event = paymentEvent('payment.updated', 'pay-3');
    assert.equal(await processDonationEvent(event, h.deps), 'recorded');
    assert.equal(await processDonationEvent(event, h.deps), 'duplicate');
    assert.equal(h.mem.donations.size, 1);
    assert.equal(h.mem.declarations.size, 1);
    assert.equal(h.recorded.length, 1, 'no second thank-you email');
  });

  test('payment.created then payment.updated, both COMPLETED, records once', async () => {
    const intent = await intentFor(h, { giftAid: true });
    h.payments.set('pay-4', { id: 'pay-4', status: 'COMPLETED', reference_id: intent.id, amount_money: { amount: 2500 } });
    await processDonationEvent(paymentEvent('payment.created', 'pay-4'), h.deps);
    assert.equal(await processDonationEvent(paymentEvent('payment.updated', 'pay-4'), h.deps), 'duplicate');
    assert.equal(h.mem.donations.size, 1);
  });

  test('a payment that has not completed records nothing, until it does', async () => {
    const intent = await intentFor(h, { giftAid: true });
    h.payments.set('pay-5', { id: 'pay-5', status: 'APPROVED', reference_id: intent.id, amount_money: { amount: 2500 } });
    assert.equal(await processDonationEvent(paymentEvent('payment.created', 'pay-5'), h.deps), 'not-completed');
    assert.equal(h.mem.donations.size, 0);
    assert.equal(h.mem.intents.get(intent.id)!.status, 'pending');

    h.payments.set('pay-5', { ...h.payments.get('pay-5')!, status: 'COMPLETED' });
    assert.equal(await processDonationEvent(paymentEvent('payment.updated', 'pay-5'), h.deps), 'recorded');
  });

  test('a FAILED or CANCELED payment never records', async () => {
    for (const status of ['FAILED', 'CANCELED']) {
      const intent = await intentFor(h, { giftAid: true });
      h.payments.set(`p-${status}`, { id: `p-${status}`, status, reference_id: intent.id, amount_money: { amount: 2500 } });
      assert.equal(await processDonationEvent(paymentEvent('payment.updated', `p-${status}`), h.deps), 'not-completed');
    }
    assert.equal(h.mem.donations.size, 0);
  });

  test('the webhook body is not trusted: status is read back from Square', async () => {
    const intent = await intentFor(h, { giftAid: false });
    // Square's API says FAILED, whatever a forged body claims.
    h.payments.set('pay-6', { id: 'pay-6', status: 'FAILED', reference_id: intent.id, amount_money: { amount: 2500 } });
    const forged = { type: 'payment.updated', data: { object: { payment: { id: 'pay-6', status: 'COMPLETED', reference_id: intent.id } } } };
    assert.equal(await processDonationEvent(forged, h.deps), 'not-completed');
    assert.equal(h.mem.donations.size, 0);
  });

  test('payments this site did not start as donations are ignored', async () => {
    h.payments.set('booking', { id: 'booking', status: 'COMPLETED', reference_id: 'MB-7K2QX4', amount_money: { amount: 1125 } });
    h.payments.set('reader', { id: 'reader', status: 'COMPLETED', amount_money: { amount: 300 } });
    assert.equal(await processDonationEvent(paymentEvent('payment.updated', 'booking'), h.deps), 'ignored');
    assert.equal(await processDonationEvent(paymentEvent('payment.updated', 'reader'), h.deps), 'ignored');
    assert.equal(h.mem.donations.size, 0);
  });

  test('a donation reference with no intent behind it is reported, not invented', async () => {
    h.payments.set('pay-7', { id: 'pay-7', status: 'COMPLETED', reference_id: 'DI-000000000000', amount_money: { amount: 500 } });
    assert.equal(await processDonationEvent(paymentEvent('payment.updated', 'pay-7'), h.deps), 'unknown-intent');
    assert.equal(h.mem.donations.size, 0);
  });

  test('the amount recorded is what Square took', async () => {
    const intent = await intentFor(h, { giftAid: false, pence: 2500 });
    h.payments.set('pay-8', { id: 'pay-8', status: 'COMPLETED', reference_id: intent.id, amount_money: { amount: 2000 } });
    await processDonationEvent(paymentEvent('payment.updated', 'pay-8'), h.deps);
    assert.equal([...h.mem.donations.values()][0].amountPence, 2000);
  });
});

describe('refunds', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => { h = harness(); });

  async function paid(pence = 2500) {
    const intent = await intentFor(h, { giftAid: true, pence });
    h.payments.set('pay-r', { id: 'pay-r', status: 'COMPLETED', reference_id: intent.id, amount_money: { amount: pence } });
    await processDonationEvent(paymentEvent('payment.updated', 'pay-r'), h.deps);
    const d = [...h.mem.donations.values()][0];
    // As if the sheet had already taken the row.
    await h.mem.store.setSync('donation', d.id, { ...d.sheet, appended: true });
    return d;
  }

  test('a completed refund marks the donation Refunded and queues the sheet Status cell', async () => {
    const d = await paid();
    h.refunds.set('ref-1', { id: 'ref-1', status: 'COMPLETED', payment_id: 'pay-r', amount_money: { amount: 2500 } });
    assert.equal(await processDonationEvent(refundEvent('refund.updated', 'ref-1'), h.deps), 'refunded');
    const after = h.mem.donations.get(d.id)!;
    assert.equal(after.status, 'Refunded');
    assert.equal(after.refundedPence, 2500);
    assert.deepEqual(after.sheet.pendingUpdates, [{ column: 'I', value: 'Refunded' }]);
    assert.deepEqual(h.refunded, [d.id]);
  });

  test('a pending refund changes nothing yet', async () => {
    const d = await paid();
    h.refunds.set('ref-2', { id: 'ref-2', status: 'PENDING', payment_id: 'pay-r', amount_money: { amount: 2500 } });
    assert.equal(await processDonationEvent(refundEvent('refund.created', 'ref-2'), h.deps), 'not-completed');
    assert.equal(h.mem.donations.get(d.id)!.status, 'Received');
  });

  test('the same refund webhook twice applies once', async () => {
    const d = await paid();
    h.refunds.set('ref-3', { id: 'ref-3', status: 'COMPLETED', payment_id: 'pay-r', amount_money: { amount: 2500 } });
    await processDonationEvent(refundEvent('refund.created', 'ref-3'), h.deps);
    assert.equal(await processDonationEvent(refundEvent('refund.updated', 'ref-3'), h.deps), 'refund-duplicate');
    assert.equal(h.mem.donations.get(d.id)!.refundedPence, 2500);
    assert.equal(h.refunded.length, 1);
  });

  test('a partial refund still marks it Refunded, conservatively, and keeps the amount', async () => {
    const d = await paid(5000);
    h.refunds.set('ref-4', { id: 'ref-4', status: 'COMPLETED', payment_id: 'pay-r', amount_money: { amount: 1000 } });
    await processDonationEvent(refundEvent('refund.updated', 'ref-4'), h.deps);
    const after = h.mem.donations.get(d.id)!;
    assert.equal(after.status, 'Refunded');
    assert.equal(after.refundedPence, 1000);
    assert.match(after.history.at(-1)!.action, /partial/);
  });

  test('a second refund on the same payment adds up, without queueing Status twice', async () => {
    const d = await paid(5000);
    h.refunds.set('a', { id: 'a', status: 'COMPLETED', payment_id: 'pay-r', amount_money: { amount: 1000 } });
    h.refunds.set('b', { id: 'b', status: 'COMPLETED', payment_id: 'pay-r', amount_money: { amount: 4000 } });
    await processDonationEvent(refundEvent('refund.updated', 'a'), h.deps);
    await processDonationEvent(refundEvent('refund.updated', 'b'), h.deps);
    const after = h.mem.donations.get(d.id)!;
    assert.equal(after.refundedPence, 5000);
    assert.equal(after.sheet.pendingUpdates.filter((u) => u.column === 'I').length, 1);
  });

  test('a refund of a payment that is not a donation is ignored', async () => {
    h.refunds.set('ref-5', { id: 'ref-5', status: 'COMPLETED', payment_id: 'some-booking', amount_money: { amount: 1125 } });
    assert.equal(await processDonationEvent(refundEvent('refund.updated', 'ref-5'), h.deps), 'ignored');
  });
});

describe('webhook signature', () => {
  const key = 'test-signature-key';
  const url = 'https://meadowbrookdartington.org/api/donate/webhooks/square';
  const body = '{"type":"payment.updated"}';
  const sig = createHmac('sha256', key).update(url + body).digest('base64');

  test('a correct signature over URL + body verifies', () => {
    assert.equal(verifySquareSignature(key, url, body, sig), true);
  });

  test('a changed body, URL, key or missing signature is refused', () => {
    assert.equal(verifySquareSignature(key, url, body + ' ', sig), false);
    assert.equal(verifySquareSignature(key, 'https://evil.example/x', body, sig), false);
    assert.equal(verifySquareSignature('other', url, body, sig), false);
    assert.equal(verifySquareSignature(key, url, body, null), false);
    assert.equal(verifySquareSignature(undefined, url, body, sig), false, 'unset key must refuse, never accept');
  });

  test('the donate webhook uses its own key, not the booking one', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/pages/api/donate/webhooks/square.ts', 'utf8');
    assert.ok(src.includes("env('DONATE_SQUARE_WEBHOOK_SIGNATURE_KEY')"));
    assert.ok(!src.includes('BOOKING_SQUARE_WEBHOOK_SIGNATURE_KEY'));
  });
});
