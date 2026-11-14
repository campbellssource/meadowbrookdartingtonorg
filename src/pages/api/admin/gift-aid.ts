// POST /api/admin/gift-aid — everything the committee capture page writes.
//
// The session is checked before the body is even read. This is the door to donors'
// home addresses, so it gets the same boring, careful treatment as the booking
// admin: the allowlist is re-checked on every request, and every record says who
// entered it and when.
//
// Firestore first, sheet second, always. A sheet failure is reported back to the
// page as a warning and left for the hourly sync; it never fails the save.

import type { APIRoute } from 'astro';
import { verifySession, ADMIN_COOKIE, ADMIN_HEADERS } from '../../../lib/booking/admin-auth.ts';
import { send } from '../../../lib/booking/email.ts';
import {
  validateDeclaration, validateOfflineDonation, validateSmallDonation, normalisePostcode, isIsoDate, londonToday,
  parsePounds,
} from '../../../lib/gift-aid/validate.ts';
import type { DeclarationMethod } from '../../../lib/gift-aid/validate.ts';
import {
  buildDeclaration, buildOfflineDonation, buildSmallDonation, confirmationPatch, cancellationPatch, claimable,
} from '../../../lib/gift-aid/records.ts';
import { firestoreStore as store } from '../../../lib/gift-aid/store.ts';
import { googleSheets } from '../../../lib/gift-aid/sheets.ts';
import { trySync, syncPending } from '../../../lib/gift-aid/sync.ts';
import type { SyncOutcome } from '../../../lib/gift-aid/sync.ts';
import { verbalConfirmationEmail } from '../../../lib/gift-aid/email.ts';
import type { Declaration } from '../../../lib/gift-aid/types.ts';

export const prerender = false;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
  });

const sheetNote = (o: SyncOutcome): string | undefined => (o === 'failed'
  ? 'Saved. The sheet could not be updated just now; it will be retried automatically.'
  : o === 'disabled' ? 'Saved. Sheet sync is not configured here (GIFT_AID_SHEET_ID is unset).' : undefined);

/** What the page needs to show a match, and no more than it needs. */
function summary(d: Declaration, today: string) {
  return {
    id: d.id,
    name: [d.title, d.firstName, d.lastName].filter(Boolean).join(' '),
    address: `${d.houseNameOrNumber} ${d.addressLine}, ${d.town} ${d.postcode}`,
    email: d.email,
    scope: d.scope,
    method: d.method,
    madeOn: d.madeOn,
    confirmationSentOn: d.confirmationSentOn,
    claimableFrom: d.claimableFrom,
    cancelledOn: d.cancelledOn,
    claimable: claimable(d, today),
  };
}

const DECLARATION_MODES: Record<string, DeclarationMethod> = { tablet: 'Tablet', paper: 'Paper', verbal: 'Verbal' };

export const POST: APIRoute = async ({ request, cookies }) => {
  const actor = verifySession(cookies.get(ADMIN_COOKIE)?.value);
  if (!actor) return json({ error: 'Not signed in.' }, 401);

  let body: Record<string, any>;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const action = String(body.action ?? '');
  const now = new Date();
  const today = londonToday(now);

  try {
    if (action === 'declaration') {
      const method = DECLARATION_MODES[String(body.mode ?? '')];
      if (!method) return json({ error: 'Unknown mode.' }, 400);
      const result = validateDeclaration(body.fields ?? {}, { method, now });
      if (!result.ok) return json({ error: 'Please check the highlighted fields.', fields: result.errors }, 400);
      const amountPence = parsePounds(body.fields?.amount);
      const d = buildDeclaration(result.value, { enteredBy: actor, now, amountPence });
      await store.createDeclaration(d);
      const outcome = await trySync(store, googleSheets, 'declaration', d.id);
      return json({
        message: method === 'Verbal'
          ? `Saved ${d.id}. Written confirmation must now be sent before it can be claimed.`
          : `Saved ${d.id}.`,
        id: d.id, warning: sheetNote(outcome),
      });
    }

    if (action === 'lookup') {
      const postcode = normalisePostcode(String(body.postcode ?? ''));
      const lastName = String(body.lastName ?? '').trim();
      if (!postcode || !lastName) return json({ error: 'Enter a last name and a full UK postcode.' }, 400);
      const matches = await store.findDeclarations(lastName, postcode);
      return json({ matches: matches.map((d) => summary(d, today)) });
    }

    if (action === 'donation') {
      const result = validateOfflineDonation(body.fields ?? {}, now);
      if (!result.ok) return json({ error: 'Please check the highlighted fields.', fields: result.errors }, 400);
      const declaration = await store.getDeclaration(result.value.declarationId);
      if (!declaration) return json({ error: 'That declaration no longer exists.' }, 404);
      const donation = buildOfflineDonation(result.value, actor, now, declaration.email);
      await store.createDonation(donation);
      const outcome = await trySync(store, googleSheets, 'donation', donation.id);
      const caveats = [
        result.value.warning,
        declaration.cancelledOn ? `The declaration was cancelled on ${declaration.cancelledOn}, so this gift is not claimable.` : null,
        declaration.method === 'Verbal' && !declaration.confirmationSentOn
          ? 'The declaration is verbal and has no written confirmation yet, so this gift is not claimable until one is sent.' : null,
        sheetNote(outcome) ?? null,
      ].filter(Boolean);
      return json({ message: `Saved ${donation.id} against ${declaration.id}.`, id: donation.id, warning: caveats.join(' ') || undefined });
    }

    if (action === 'small') {
      const result = validateSmallDonation(body.fields ?? {}, now);
      if (!result.ok) return json({ error: 'Please check the highlighted fields.', fields: result.errors }, 400);
      const s = buildSmallDonation(result.value, actor, now);
      await store.createSmallDonation(s);
      const outcome = await trySync(store, googleSheets, 'small', s.id);
      return json({ message: `Saved ${s.id}.`, id: s.id, warning: sheetNote(outcome) });
    }

    if (action === 'confirm-verbal') {
      const id = String(body.id ?? '');
      const how = body.how === 'email' ? 'email' : 'post';
      const sentOn = how === 'email' ? today : String(body.sentOn ?? '');
      if (!isIsoDate(sentOn) || sentOn > today) return json({ error: 'Enter the date the letter was posted.' }, 400);

      const existing = await store.getDeclaration(id);
      if (!existing) return json({ error: 'No such declaration.' }, 404);
      if (existing.method !== 'Verbal') return json({ error: 'Only verbal declarations need a written confirmation.' }, 400);
      if (existing.confirmationSentOn) return json({ message: `Already confirmed on ${existing.confirmationSentOn}.` });
      if (how === 'email') {
        if (!existing.email) return json({ error: 'There is no email address for this donor. Post a letter instead.' }, 400);
        // Send first: recording "sent" for an email that never left would make a
        // declaration claimable without the written record HMRC requires.
        await send(verbalConfirmationEmail(existing.email, existing));
      }
      const updated = await store.updateDeclaration(id, (d) => confirmationPatch(d, sentOn, how, actor, now));
      const outcome = await trySync(store, googleSheets, 'declaration', id);
      return json({
        message: `Confirmation recorded. Claimable from ${updated?.claimableFrom ?? '?'} unless the donor cancels.`,
        warning: sheetNote(outcome),
      });
    }

    if (action === 'cancel-declaration') {
      const id = String(body.id ?? '');
      const cancelledOn = String(body.cancelledOn ?? '') || today;
      if (!isIsoDate(cancelledOn) || cancelledOn > today) return json({ error: 'Enter a valid cancellation date.' }, 400);
      const updated = await store.updateDeclaration(id, (d) => cancellationPatch(d, cancelledOn, actor, now));
      if (!updated) return json({ error: 'No such declaration.' }, 404);
      const outcome = await trySync(store, googleSheets, 'declaration', id);
      return json({ message: `Cancelled from ${updated.cancelledOn}.`, warning: sheetNote(outcome) });
    }

    if (action === 'retry-sync') {
      const report = await syncPending(store, googleSheets);
      if (report.disabled) return json({ message: 'Sheet sync is not configured here (GIFT_AID_SHEET_ID is unset).' });
      return json({ message: `${report.synced} sent to the sheet, ${report.failed} still failing.` });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('admin/gift-aid: failed', { action, message });
    return json({ error: `That did not save. ${message.slice(0, 200)}` }, 500);
  }
};
