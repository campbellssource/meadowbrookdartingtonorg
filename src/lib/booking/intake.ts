// Answers to a room's intake questions ("How do you intend to use the room?").
//
// Stored on the booking as a single `customer.notes` string, one `Label answer`
// line per question, which is the shape bookings made before this module already
// have. The server builds it from the room's own questions rather than trusting a
// string the browser assembled, so a required question is enforced here and not
// only by the form's `required` attribute.

import type { IntakeQuestion } from './config.ts';

const MAX_ANSWER = 1000;

export type IntakeResult = { ok: true; notes: string } | { ok: false; error: string };

/**
 * `answers` is keyed by question key. `legacyNotes` is the pre-assembled string an
 * older copy of the form sends; it is accepted only when no `answers` arrived, so
 * a page loaded before a deploy can still book.
 */
export function buildIntakeNotes(
  questions: readonly IntakeQuestion[], answers: unknown, legacyNotes: unknown,
): IntakeResult {
  const given = answers && typeof answers === 'object' ? answers as Record<string, unknown> : null;
  if (!given) {
    const notes = String(legacyNotes ?? '').trim().slice(0, MAX_ANSWER);
    const labelsOnly = questions.every((q) => !notes.replace(q.label, '').trim());
    if (questions.some((q) => q.required) && (!notes || labelsOnly)) {
      return { ok: false, error: `Please tell us: ${questions.find((q) => q.required)!.label}` };
    }
    return { ok: true, notes };
  }
  const lines: string[] = [];
  for (const q of questions) {
    const a = String(given[q.key] ?? '').trim().slice(0, MAX_ANSWER);
    if (!a) {
      if (q.required) return { ok: false, error: `Please tell us: ${q.label}` };
      continue;
    }
    lines.push(`${q.label} ${a}`);
  }
  return { ok: true, notes: lines.join('\n') };
}

/**
 * The notes with the question wording taken off, for places that already say what
 * the column is ("Intended use"). Lines that match no question are kept whole.
 */
export function intakeAnswers(notes: string | undefined, questions: readonly IntakeQuestion[]): string {
  if (!notes) return '';
  return notes.split('\n').map((line) => {
    const q = questions.find((x) => line.startsWith(x.label));
    return q ? line.slice(q.label.length).trim() : line.trim();
  }).filter(Boolean).join('\n');
}
