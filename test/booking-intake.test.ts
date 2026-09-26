import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildIntakeNotes, intakeAnswers } from '../src/lib/booking/intake.ts';

const USE = { key: 'use', label: 'How do you intend to use the room?', required: true };

describe('buildIntakeNotes', () => {
  test('pairs each answer with the room\'s own wording', () => {
    assert.deepEqual(buildIntakeNotes([USE], { use: ' Yoga class ' }, undefined),
      { ok: true, notes: 'How do you intend to use the room? Yoga class' });
  });

  test('a required question left blank is refused, not stored as its label', () => {
    const r = buildIntakeNotes([USE], { use: '   ' }, undefined);
    assert.equal(r.ok, false);
  });

  test('a room with no questions needs no answers', () => {
    assert.deepEqual(buildIntakeNotes([], {}, undefined), { ok: true, notes: '' });
  });

  test('keys the room does not ask about are ignored', () => {
    assert.deepEqual(buildIntakeNotes([], { use: 'injected' }, undefined), { ok: true, notes: '' });
  });

  // A page loaded before the deploy still sends the old pre-assembled string.
  test('legacy notes are accepted when they carry an answer', () => {
    const r = buildIntakeNotes([USE], undefined, 'How do you intend to use the room? Pilates');
    assert.deepEqual(r, { ok: true, notes: 'How do you intend to use the room? Pilates' });
  });

  test('legacy notes that are only the label are refused', () => {
    assert.equal(buildIntakeNotes([USE], undefined, 'How do you intend to use the room?').ok, false);
    assert.equal(buildIntakeNotes([USE], undefined, '').ok, false);
  });
});

describe('intakeAnswers', () => {
  test('strips the question wording', () => {
    assert.equal(intakeAnswers('How do you intend to use the room? Choir practice', [USE]), 'Choir practice');
  });
  test('empty for no notes', () => {
    assert.equal(intakeAnswers(undefined, [USE]), '');
  });
});
