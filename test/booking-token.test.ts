import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { issue, verify, expiryFor } from '../src/lib/booking/token.ts';

const end = new Date('2027-01-15T16:00:00Z');
let prev: string | undefined;
before(() => { prev = process.env.BOOKING_MAGIC_LINK_SECRET; process.env.BOOKING_MAGIC_LINK_SECRET = 'test-secret-at-least-32-bytes-long!!'; });
after(() => { if (prev === undefined) delete process.env.BOOKING_MAGIC_LINK_SECRET; else process.env.BOOKING_MAGIC_LINK_SECRET = prev; });

describe('issue and verify', () => {
  test('a fresh token verifies and carries its claims', () => {
    const { token, jti } = issue('MB-7K2QX4', 'J@Example.com', end);
    const r = verify(token, new Date('2027-01-15T17:00:00Z'));
    assert.ok(r.ok);
    assert.equal(r.payload.ref, 'MB-7K2QX4');
    assert.equal(r.payload.email, 'j@example.com', 'email is lower-cased');
    assert.equal(r.payload.jti, jti);
  });

  test('two tokens for the same booking differ', () => {
    assert.notEqual(issue('MB-7K2QX4', 'a@b.co', end).token, issue('MB-7K2QX4', 'a@b.co', end).token);
  });

  test('expires 30 days after the booking ends', () => {
    assert.equal(expiryFor(end), Math.floor((end.getTime() + 30 * 86400000) / 1000));
    const { token } = issue('MB-7K2QX4', 'a@b.co', end);
    assert.equal(verify(token, new Date('2027-02-13T16:00:00Z')).ok, true, '29 days: still valid');
    const late = verify(token, new Date('2027-02-15T16:00:00Z'));
    assert.equal(late.ok, false);
    assert.equal(late.reason, 'expired');
  });
});

describe('tampering', () => {
  const good = () => issue('MB-7K2QX4', 'j@example.com', end).token;

  test('a flipped signature character is rejected', () => {
    const t = good();
    const i = t.lastIndexOf('.') + 1;
    const flipped = t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1);
    assert.equal(verify(flipped).reason, 'bad-signature');
  });

  test('a rewritten payload is rejected -- you cannot change which booking it opens', () => {
    const t = good();
    const [, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({
      jti: 'x', ref: 'MB-OTHER', email: 'j@example.com', exp: expiryFor(end),
    })).toString('base64url');
    const r = verify(`${forged}.${sig}`);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'bad-signature');
  });

  test('a truncated signature is rejected without throwing', () => {
    const t = good();
    assert.equal(verify(t.slice(0, t.length - 4)).reason, 'bad-signature');
  });

  test('garbage is rejected as malformed, not as a crash', () => {
    for (const junk of ['', '.', 'abc', 'a.b.c', 'no-dot-at-all']) {
      const r = verify(junk);
      assert.equal(r.ok, false, junk);
      assert.ok(['malformed', 'bad-signature'].includes(r.reason), `${junk} -> ${r.reason}`);
    }
  });

  test('a token signed with a different secret is rejected', () => {
    const t = good();
    process.env.BOOKING_MAGIC_LINK_SECRET = 'a-completely-different-secret-value!!';
    assert.equal(verify(t).reason, 'bad-signature');
    process.env.BOOKING_MAGIC_LINK_SECRET = 'test-secret-at-least-32-bytes-long!!';
  });
});

describe('scoping', () => {
  test('a token for booking A does not verify as booking B', () => {
    const a = issue('MB-AAAAAA', 'j@example.com', end);
    const r = verify(a.token);
    assert.ok(r.ok);
    // The caller compares ref; the token cannot be made to claim another booking
    // without breaking the signature, which the tampering tests above cover.
    assert.equal(r.payload.ref, 'MB-AAAAAA');
    assert.notEqual(r.payload.ref, 'MB-BBBBBB');
  });
});
