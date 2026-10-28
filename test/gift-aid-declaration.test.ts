import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  renderDeclaration, DECLARATION_VERSION, DECLARATIONS, giftAidOn, formatPounds, CHARITY_NUMBER,
} from '../src/lib/gift-aid/declaration.ts';
import {
  validateDeclaration, normalisePostcode, isIsoDate, validateOfflineDonation, validateSmallDonation, parsePounds,
  campaignFor,
} from '../src/lib/gift-aid/validate.ts';
import { retainUntil, accountingPeriodEnd, addDays } from '../src/lib/gift-aid/retention.ts';
import { buildDeclaration, confirmationPatch, cancellationPatch, claimable } from '../src/lib/gift-aid/records.ts';

// The HMRC declaration. Its wording, its opt-in and the donor's address are what
// make a claim valid, so they are pinned here rather than trusted to stay right.

const NOW = new Date('2026-10-25T10:00:00Z');

const good = (over: Record<string, unknown> = {}) => ({
  optIn: true, title: 'Mrs', firstName: 'Jane', lastName: 'Smith-Jones', houseNameOrNumber: '12',
  addressLine: 'Example Road', town: 'Dartington', postcode: 'tq9 6ej', email: 'Jane@Example.com',
  scope: 'Enduring', ...over,
});

describe('declaration wording', () => {
  test('v1 enduring wording is exactly what the DRA supplied', () => {
    assert.equal(DECLARATION_VERSION, 'v1');
    assert.equal(
      renderDeclaration('Enduring', 2500),
      'I want to Gift Aid my donation of £25 and any donations I make in the future or have made in the '
      + 'past 4 years to Dartington Recreation Association. I am a UK taxpayer and understand that if I pay '
      + 'less Income Tax and/or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in '
      + 'that tax year it is my responsibility to pay any difference.',
    );
  });

  test('the sheet holds the same v1 wording, with its blank for the amount', () => {
    // The bookkeeper's Settings tab says: "...my donation of £___ and any donations..."
    assert.equal(
      DECLARATIONS.v1.Enduring.replace('{amount}', 'my donation of £___'),
      'I want to Gift Aid my donation of £___ and any donations I make in the future or have made in the '
      + 'past 4 years to Dartington Recreation Association. I am a UK taxpayer and understand that if I pay '
      + 'less Income Tax and/or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in '
      + 'that tax year it is my responsibility to pay any difference.',
    );
  });

  test('single scope drops the past-and-future clause and nothing else', () => {
    const single = renderDeclaration('Single', 1050);
    assert.match(single, /^I want to Gift Aid my donation of £10\.50 to Dartington Recreation Association\. I am a UK taxpayer/);
    assert.doesNotMatch(single, /future|past 4 years/);
  });

  test('no amount reads "my donation"', () => {
    assert.match(renderDeclaration('Enduring', null), /^I want to Gift Aid my donation and any donations/);
  });

  test('an unknown version is refused rather than rendered blank', () => {
    assert.throws(() => renderDeclaration('Enduring', 100, 'v99'));
  });

  test('the boost is 25p per £1, never rounded up', () => {
    assert.equal(giftAidOn(2500), 625);
    assert.equal(giftAidOn(101), 25);
    assert.equal(formatPounds(3125), '£31.25');
    assert.equal(formatPounds(500), '£5');
  });

  test('the charity number is the registered one, on the donate page too', () => {
    assert.equal(CHARITY_NUMBER, '1168817');
    const page = readFileSync('src/pages/donate.astro', 'utf8');
    assert.ok(page.includes('1168817'), 'donate page should show 1168817');
    assert.ok(!page.includes('1205473'), 'the wrong charity number is back on the donate page');
  });

  test('the wording is config, not Keystatic: nothing editable in the CMS can change it', () => {
    const keystatic = readFileSync('keystatic.config.ts', 'utf8');
    assert.ok(!/gift.?aid/i.test(keystatic), 'Gift Aid wording must not be CMS-editable without a version bump');
  });
});

describe('the opt-in', () => {
  test('only the boolean true is a declaration', () => {
    for (const optIn of [undefined, false, 'true', 1, 'on', null]) {
      const r = validateDeclaration(good({ optIn }), { method: 'Online', now: NOW });
      assert.equal(r.ok, false, `optIn ${JSON.stringify(optIn)} must not count`);
      if (!r.ok) assert.ok(r.errors.optIn);
    }
  });

  test('the checkbox is rendered unticked and reset on load', () => {
    const src = readFileSync('src/components/GiftAidFields.astro', 'utf8');
    const box = src.match(/<input type="checkbox" name="optIn"[^>]*>/)?.[0] ?? '';
    assert.ok(box, 'opt-in checkbox not found');
    assert.ok(!/checked/.test(box), 'the Gift Aid box must never be pre-ticked');
    assert.ok(src.includes('optin.checked = false'), 'a box restored by the browser on Back must be cleared');
  });
});

describe('declaration validation', () => {
  test('a complete declaration passes and is normalised', () => {
    const r = validateDeclaration(good(), { method: 'Online', now: NOW });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.value.postcode, 'TQ9 6EJ');
    assert.equal(r.value.email, 'jane@example.com');
    assert.equal(r.value.madeOn, '2026-10-25');
    assert.equal(r.value.scope, 'Enduring');
  });

  test('every required field is named when missing', () => {
    const r = validateDeclaration({ optIn: true, scope: 'Enduring' }, { method: 'Online', now: NOW });
    assert.equal(r.ok, false);
    if (r.ok) return;
    for (const f of ['firstName', 'lastName', 'houseNameOrNumber', 'addressLine', 'town', 'postcode', 'email']) {
      assert.ok(r.errors[f as keyof typeof r.errors], `${f} should be required`);
    }
    assert.equal(r.errors.title, undefined, 'title is optional');
  });

  test('title is at most 4 characters', () => {
    assert.ok(validateDeclaration(good({ title: 'Prof' }), { method: 'Online', now: NOW }).ok);
    const r = validateDeclaration(good({ title: 'Profe' }), { method: 'Online', now: NOW });
    assert.equal(r.ok, false);
    assert.ok(validateDeclaration(good({ title: '' }), { method: 'Online', now: NOW }).ok);
  });

  test('scope must be Single or Enduring', () => {
    assert.equal(validateDeclaration(good({ scope: 'Forever' }), { method: 'Online', now: NOW }).ok, false);
    assert.ok(validateDeclaration(good({ scope: 'Single' }), { method: 'Online', now: NOW }).ok);
  });

  test('email is required online and on the tablet, optional on paper and verbal', () => {
    const none = good({ email: '', madeOn: '2026-10-20' });
    assert.equal(validateDeclaration(none, { method: 'Online', now: NOW }).ok, false);
    assert.equal(validateDeclaration(none, { method: 'Tablet', now: NOW }).ok, false);
    assert.ok(validateDeclaration(none, { method: 'Paper', now: NOW }).ok);
    assert.ok(validateDeclaration(none, { method: 'Verbal', now: NOW }).ok);
    assert.equal(validateDeclaration(good({ email: 'not-an-email' }), { method: 'Paper', now: NOW }).ok, false);
  });

  test('online the date is today whatever the client says; on paper it is the date signed', () => {
    const online = validateDeclaration(good({ madeOn: '2020-01-01' }), { method: 'Online', now: NOW });
    assert.ok(online.ok && online.value.madeOn === '2026-10-25');
    const paper = validateDeclaration(good({ madeOn: '2026-10-18' }), { method: 'Paper', now: NOW });
    assert.ok(paper.ok && paper.value.madeOn === '2026-10-18');
    assert.equal(validateDeclaration(good({ madeOn: '' }), { method: 'Paper', now: NOW }).ok, false);
    assert.equal(validateDeclaration(good({ madeOn: '2026-10-26' }), { method: 'Verbal', now: NOW }).ok, false, 'future');
    assert.equal(validateDeclaration(good({ madeOn: '2026-02-31' }), { method: 'Paper', now: NOW }).ok, false, 'not a date');
  });

  test('scan links must be Google Drive', () => {
    const base = good({ madeOn: '2026-10-18' });
    assert.ok(validateDeclaration({ ...base, scanLink: 'https://drive.google.com/file/d/abc/view' }, { method: 'Paper', now: NOW }).ok);
    assert.equal(validateDeclaration({ ...base, scanLink: 'https://evil.example/x' }, { method: 'Paper', now: NOW }).ok, false);
    assert.equal(validateDeclaration({ ...base, scanLink: 'javascript:alert(1)' }, { method: 'Paper', now: NOW }).ok, false);
  });

  test('names are capped at HMRC lengths', () => {
    assert.equal(validateDeclaration(good({ lastName: 'x'.repeat(36) }), { method: 'Online', now: NOW }).ok, false);
    assert.ok(validateDeclaration(good({ lastName: 'x'.repeat(35) }), { method: 'Online', now: NOW }).ok);
  });
});

describe('UK postcodes', () => {
  test('stored in capitals with one space', () => {
    assert.equal(normalisePostcode('tq96ej'), 'TQ9 6EJ');
    assert.equal(normalisePostcode('  tq9   6ej '), 'TQ9 6EJ');
    assert.equal(normalisePostcode('SW1A1AA'), 'SW1A 1AA');
    assert.equal(normalisePostcode('m11ae'), 'M1 1AE');
    assert.equal(normalisePostcode('ec1a 1bb'), 'EC1A 1BB');
    assert.equal(normalisePostcode('GIR 0AA'), 'GIR 0AA');
  });

  test('not-postcodes are refused', () => {
    for (const bad of ['', '12345', '94103', 'TQ9', 'TQ9 6E', 'TQ96EJJ', 'Q1 1AA1', '9Q9 6EJ']) {
      assert.equal(normalisePostcode(bad), null, bad);
    }
  });
});

describe('dates and money', () => {
  test('ISO dates must be real', () => {
    assert.ok(isIsoDate('2028-02-29'));
    assert.equal(isIsoDate('2027-02-29'), false);
    assert.equal(isIsoDate('25/10/2026'), false);
  });

  test('pounds parse to integer pence without floats', () => {
    assert.equal(parsePounds('12.5'), 1250);
    assert.equal(parsePounds('£1,000'), 100000);
    assert.equal(parsePounds('0.1'), 10);
    assert.equal(parsePounds('19.99'), 1999);
    assert.equal(parsePounds('1.234'), null);
    assert.equal(parsePounds('-5'), null);
    assert.equal(parsePounds('abc'), null);
  });

  test('campaign comes from ?campaign=pool and nothing else', () => {
    assert.equal(campaignFor('pool'), 'Pool appeal');
    assert.equal(campaignFor('Pool appeal'), 'General');
    assert.equal(campaignFor(undefined), 'General');
  });
});

describe('offline donations and small collections', () => {
  const donation = { declarationId: 'GA-7K2QX4', amount: '50', receivedOn: '2026-10-20', method: 'Cheque', campaign: 'Pool appeal' };

  test('a cheque against a declaration passes', () => {
    const r = validateOfflineDonation(donation, NOW);
    assert.ok(r.ok && r.value.amountPence === 5000 && r.value.warning === null);
  });

  test('a donation must name a declaration, a method and a campaign', () => {
    const r = validateOfflineDonation({ amount: '5' }, NOW);
    assert.equal(r.ok, false);
    if (!r.ok) for (const f of ['declarationId', 'receivedOn', 'method', 'campaign']) assert.ok(r.errors[f], f);
  });

  test('cash of £30 or less is allowed with a declaration, but flagged', () => {
    const r = validateOfflineDonation({ ...donation, method: 'Cash', amount: '30' }, NOW);
    assert.ok(r.ok && r.value.warning);
    const big = validateOfflineDonation({ ...donation, method: 'Cash', amount: '30.01' }, NOW);
    assert.ok(big.ok && big.value.warning === null);
  });

  test('online is not an offline method', () => {
    assert.equal(validateOfflineDonation({ ...donation, method: 'Online' }, NOW).ok, false);
  });

  test('a small collection needs no donor details, and inBuilding must be a real boolean', () => {
    const ok = validateSmallDonation({ collectedOn: '2026-10-20', eventOrPlace: 'Coffee club tin', amount: '42.50', kind: 'Cash', inBuilding: true }, NOW);
    assert.ok(ok.ok && ok.value.amountPence === 4250);
    const r = validateSmallDonation({ collectedOn: '2026-10-20', eventOrPlace: 'x', amount: '5', kind: 'Cash', inBuilding: 'Y' }, NOW);
    assert.equal(r.ok, false);
  });
});

describe('retention: 6 years after the accounting period of the last gift', () => {
  test('the DRA year ends 31 March', () => {
    assert.equal(accountingPeriodEnd('2026-10-25'), '2027-03-31');
    assert.equal(accountingPeriodEnd('2027-03-31'), '2027-03-31');
    assert.equal(accountingPeriodEnd('2027-04-01'), '2028-03-31');
    assert.equal(accountingPeriodEnd('2027-01-15'), '2027-03-31');
  });

  test('six years on from that', () => {
    assert.equal(retainUntil('2026-10-25'), '2033-03-31');
    assert.equal(retainUntil('2027-04-01'), '2034-03-31');
  });
});

describe('verbal declarations', () => {
  const verbal = () => {
    const r = validateDeclaration(good({ madeOn: '2026-10-20' }), { method: 'Verbal', now: NOW });
    assert.ok(r.ok);
    return buildDeclaration((r as { value: any }).value, { enteredBy: 'treasurer@meadowbrookdartington.org', now: NOW });
  };

  test('are not claimable until a written confirmation has been sent and 30 days have passed', () => {
    const d = verbal();
    assert.equal(d.confirmationSentOn, null);
    assert.equal(claimable(d, '2026-12-31'), false);

    const patch = confirmationPatch(d, '2026-10-25', 'email', 'treasurer@x', NOW)!;
    const confirmed = { ...d, ...patch };
    assert.equal(confirmed.claimableFrom, addDays('2026-10-25', 30));
    assert.equal(confirmed.claimableFrom, '2026-11-24');
    assert.equal(claimable(confirmed, '2026-11-23'), false);
    assert.equal(claimable(confirmed, '2026-11-24'), true);
    assert.deepEqual(confirmed.sheet.pendingUpdates, [{ column: 'N', value: '2026-10-25' }]);
  });

  test('confirming twice changes nothing', () => {
    const d = verbal();
    const once = { ...d, ...confirmationPatch(d, '2026-10-25', 'post', 'a', NOW)! };
    assert.equal(confirmationPatch(once, '2026-10-26', 'post', 'a', NOW), null);
  });

  test('only verbal declarations take a confirmation', () => {
    const r = validateDeclaration(good({ madeOn: '2026-10-20' }), { method: 'Paper', now: NOW });
    assert.ok(r.ok);
    const paper = buildDeclaration((r as { value: any }).value, { enteredBy: 'x', now: NOW });
    assert.equal(confirmationPatch(paper, '2026-10-25', 'post', 'a', NOW), null);
    assert.equal(claimable(paper, '2026-10-25'), true);
  });

  test('a cancelled declaration is never claimable, and cancelling queues column O', () => {
    const d = verbal();
    const cancelled = { ...d, ...cancellationPatch(d, '2026-10-25', 'a', NOW)! };
    assert.equal(claimable(cancelled, '2030-01-01'), false);
    assert.deepEqual(cancelled.sheet.pendingUpdates, [{ column: 'O', value: '2026-10-25' }]);
    assert.equal(cancellationPatch(cancelled, '2026-10-26', 'a', NOW), null);
  });

  test('every declaration records who entered it, when, and the words shown', () => {
    const d = verbal();
    assert.equal(d.enteredBy, 'treasurer@meadowbrookdartington.org');
    assert.equal(d.enteredAt.toISOString(), NOW.toISOString());
    assert.equal(d.wordingVersion, 'v1');
    assert.match(d.wordingText, /^I want to Gift Aid my donation and any donations/);
  });
});
