import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAcceptableDoorCode, isTooSimple, phoneDoorCode, doorCodeFor, generateDoorCode,
  allocateDoorCode, doorCodeOf, doorCodeReleaseAt, DoorCodeExhaustedError,
  GENERATED_DOOR_CODE_LENGTH,
} from '../src/lib/booking/door-code.ts';

// Confirmed against production TTLock responses, 3 Sep 2026. If the validator
// ever disagrees with either list, it is the validator that is wrong.
const REJECTED_BY_TTLOCK = ['5555', '7777', '6666', '0123', '4321'];
const ACCEPTED_BY_TTLOCK = ['0111', '0321', '0456', '0789', '0044', '2216', '4664', '1726', '1952', '2868'];

describe('the too-simple rule', () => {
  test('rejects every code production TTLock rejected', () => {
    for (const c of REJECTED_BY_TTLOCK) assert.equal(isAcceptableDoorCode(c), false, c);
  });

  test('accepts every code production TTLock accepted', () => {
    for (const c of ACCEPTED_BY_TTLOCK) assert.equal(isAcceptableDoorCode(c), true, c);
  });

  test('a run of four identical digits anywhere in a longer code', () => {
    for (const c of ['66661', '155551', '20000', '000012', '1233334']) {
      assert.equal(isTooSimple(c), true, c);
    }
  });

  test('a strictly consecutive run of four, ascending or descending', () => {
    for (const c of ['12345', '98765', '01234', '43210', '56789', '876543', '71234', '54321']) {
      assert.equal(isTooSimple(c), true, c);
    }
  });

  test('9 to 0 and 0 to 9 count as consecutive, over-strictly on purpose', () => {
    for (const c of ['9012', '2109', '8901', '1098', '0987', '7890', '89012']) {
      assert.equal(isTooSimple(c), true, c);
    }
  });

  test('three in a row is fine; the rule is about four', () => {
    for (const c of ['1235', '5670', '0119', '3219', '8990', '1110', '0001', '4560']) {
      assert.equal(isAcceptableDoorCode(c), true, c);
    }
  });

  test('length: between 4 and 9 digits', () => {
    assert.equal(isAcceptableDoorCode('135'), false);
    assert.equal(isAcceptableDoorCode('1357'), true);
    assert.equal(isAcceptableDoorCode('135792468'), true);
    assert.equal(isAcceptableDoorCode('1357924680'), false);
  });

  test('digits only, and strings only', () => {
    for (const c of ['12a4', ' 1726', '1726 ', '', '17-26', '4664\n']) {
      assert.equal(isAcceptableDoorCode(c), false, JSON.stringify(c));
    }
    // A number has no leading zero and is never a code.
    assert.equal(isAcceptableDoorCode(1726 as unknown as string), false);
  });

  test('a leading zero is part of the code', () => {
    assert.equal(isAcceptableDoorCode('0044'), true);
    assert.equal(isAcceptableDoorCode('0001'), true);
    assert.equal(isAcceptableDoorCode('0000'), false);
  });
});

describe('the phone-derived candidate', () => {
  test('is the last four digits of a real number, however it was typed', () => {
    assert.equal(phoneDoorCode('07725 972868'), '2868');
    assert.equal(phoneDoorCode('+44 7725 972868'), '2868');
    assert.equal(phoneDoorCode('+44 (0)7725-972868'), '2868');
  });

  test('keeps a leading zero', () => {
    assert.equal(phoneDoorCode('+447443960044'), '0044');
  });

  test('is refused when too simple, even though it really is the number', () => {
    assert.equal(doorCodeFor('07700905555'), '5555', 'the fragment exists');
    assert.equal(phoneDoorCode('07700905555'), null, 'but the lock would refuse it');
    assert.equal(phoneDoorCode('07700901234'), null);
  });

  test('is refused for something that is not a phone number', () => {
    assert.equal(phoneDoorCode('12345'), null);
    assert.equal(phoneDoorCode(''), null);
    assert.equal(doorCodeFor('12345'), null);
  });
});

describe('generated codes', () => {
  test('are five digits, as a string, and acceptable to the lock', () => {
    for (let i = 0; i < 300; i += 1) {
      const c = generateDoorCode();
      assert.equal(typeof c, 'string');
      assert.match(c, new RegExp(`^\\d{${GENERATED_DOOR_CODE_LENGTH}}$`));
      assert.equal(isAcceptableDoorCode(c), true, c);
    }
  });

  test('keep leading zeros rather than shrinking to fewer digits', () => {
    assert.equal(generateDoorCode(() => 412), '00412');
    assert.equal(generateDoorCode(() => 71), '00071');
  });

  test('a draw whose padding makes it too simple is redrawn', () => {
    // 7 pads to "00007", which has a run of four zeros.
    const draws = [7, 71];
    let i = 0;
    assert.equal(generateDoorCode(() => draws[i++]), '00071');
  });

  test('draw again when the draw is too simple', () => {
    const draws = [12345, 55555, 90123, 48213];
    let i = 0;
    assert.equal(generateDoorCode(() => draws[i++]), '48213');
  });

  test('can never equal a phone-derived code, which is four digits', () => {
    assert.notEqual(GENERATED_DOOR_CODE_LENGTH, 4);
  });
});

describe('allocation', () => {
  const free = () => true;
  const seq = (...codes: string[]) => { let i = 0; return () => codes[i++]; };

  test('prefers the phone fragment when it is acceptable and free', async () => {
    const r = await allocateDoorCode({ phone: '07725972868', isFree: free });
    assert.deepEqual(r, { code: '2868', source: 'phone' });
  });

  test('a phone fragment with a leading zero is kept as a string', async () => {
    const r = await allocateDoorCode({ phone: '+447443960044', isFree: free });
    assert.deepEqual(r, { code: '0044', source: 'phone' });
  });

  test('falls back to a generated code when the fragment is too simple', async () => {
    const r = await allocateDoorCode({ phone: '07700905555', isFree: free, generate: seq('48213') });
    assert.deepEqual(r, { code: '48213', source: 'generated' });
  });

  test('falls back when the fragment is in use by a live booking', async () => {
    const r = await allocateDoorCode({
      phone: '07725972868', isFree: (c) => c !== '2868', generate: seq('48213'),
    });
    assert.deepEqual(r, { code: '48213', source: 'generated' });
  });

  test('falls back when there is no phone number, or not enough of one', async () => {
    for (const phone of ['', '12345', '07725']) {
      const r = await allocateDoorCode({ phone, isFree: free, generate: seq('48213') });
      assert.deepEqual(r, { code: '48213', source: 'generated' }, JSON.stringify(phone));
    }
  });

  test('never hands out a code on the avoid list, whatever isFree says', async () => {
    const fromPhone = await allocateDoorCode({
      phone: '07725972868', isFree: free, avoid: ['2868'], generate: seq('48213'),
    });
    assert.deepEqual(fromPhone, { code: '48213', source: 'generated' });
    const generated = await allocateDoorCode({
      phone: '', isFree: free, avoid: ['48213'], generate: seq('48213', '30592'),
    });
    assert.deepEqual(generated, { code: '30592', source: 'generated' });
  });

  test('skips generated codes that are taken', async () => {
    const asked: string[] = [];
    const r = await allocateDoorCode({
      phone: '', generate: seq('48213', '30592'),
      isFree: (c) => { asked.push(c); return c !== '48213'; },
    });
    assert.deepEqual(r, { code: '30592', source: 'generated' });
    assert.deepEqual(asked, ['48213', '30592']);
  });

  test('is idempotent: a booking that has a code keeps it', async () => {
    const existing = { code: '48213', source: 'generated' as const };
    const r = await allocateDoorCode({ phone: '07725972868', existing, isFree: free });
    assert.deepEqual(r, existing, 'even though the phone fragment is free now');
    const phone = { code: '0044', source: 'phone' as const };
    assert.deepEqual(await allocateDoorCode({ phone: '07725972868', existing: phone, isFree: free }), phone);
  });

  test('gives up rather than loop forever', async () => {
    await assert.rejects(
      () => allocateDoorCode({ phone: '', isFree: () => false, maxAttempts: 3 }),
      DoorCodeExhaustedError,
    );
  });
});

describe('what a booker is shown', () => {
  const at = { toDate: () => new Date() } as any;

  test('the stored allocation wins over the phone number', () => {
    const b = { doorCode: { code: '48213', source: 'generated' as const, allocatedAt: at }, customer: { phone: '07725972868' } };
    assert.deepEqual(doorCodeOf(b), { code: '48213', source: 'generated' });
  });

  test('a booking from before allocation shows the phone fragment, as the door system derived it', () => {
    assert.deepEqual(doorCodeOf({ customer: { phone: '07725972868' } }), { code: '2868', source: 'phone' });
  });

  test('nothing when there is neither', () => {
    assert.equal(doorCodeOf({ customer: {} }), null);
    assert.equal(doorCodeOf({ customer: { phone: '123' } }), null);
  });
});

describe('release', () => {
  test('a code is held until a day after the booking ends', () => {
    const end = new Date('2026-10-14T19:30:00Z');
    assert.equal(doorCodeReleaseAt(end).toISOString(), '2026-10-15T19:30:00.000Z');
  });
});
