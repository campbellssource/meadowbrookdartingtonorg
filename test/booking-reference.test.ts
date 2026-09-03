import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateReference, normaliseReference, isValidReference } from '../src/lib/booking/reference.ts';

describe('generation', () => {
  test('shaped MB- plus six Crockford characters', () => {
    for (let i = 0; i < 200; i += 1) {
      assert.match(generateReference(), /^MB-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
    }
  });

  test('never contains I, L, O or U', () => {
    for (let i = 0; i < 500; i += 1) {
      assert.ok(!/[ILOU]/.test(generateReference().slice(3)));
    }
  });

  test('not sequential -- 1000 references are effectively all distinct', () => {
    const seen = new Set(Array.from({ length: 1000 }, generateReference));
    assert.ok(seen.size > 995, `expected ~1000 distinct, got ${seen.size}`);
  });
});

describe('normalising what a human typed', () => {
  test('round-trips a generated reference', () => {
    const r = generateReference();
    assert.equal(normaliseReference(r), r);
  });

  test('forgives case, spacing and a missing prefix', () => {
    assert.equal(normaliseReference('mb-7k2qx4'), 'MB-7K2QX4');
    assert.equal(normaliseReference('7K2QX4'), 'MB-7K2QX4');
    assert.equal(normaliseReference('  MB 7K2QX4 '), 'MB-7K2QX4');
    assert.equal(normaliseReference('mb7k2qx4'), 'MB-7K2QX4');
  });

  test('fixes the confusions Crockford exists to avoid', () => {
    assert.equal(normaliseReference('MB-7K2QXI'), 'MB-7K2QX1');
    assert.equal(normaliseReference('MB-7K2QXL'), 'MB-7K2QX1');
    assert.equal(normaliseReference('MB-7K2QXO'), 'MB-7K2QX0');
  });

  test('rejects the wrong length and stray characters', () => {
    assert.equal(normaliseReference('MB-7K2QX'), null);
    assert.equal(normaliseReference('MB-7K2QX44'), null);
    assert.equal(normaliseReference('MB-7K2QX!'), null);
    assert.equal(normaliseReference(''), null);
    assert.equal(isValidReference('nonsense'), false);
  });
});
