// Admin actions on a booking: resend, cancel, refund, note.
//
// Every money action records who did it. That is the difference between an audit
// trail and a shrug when someone asks in six months why a refund was issued.

import type { APIRoute } from 'astro';
import { canonicalOrigin } from '../../../lib/booking/env.ts';
import { verifySession, ADMIN_COOKIE, ADMIN_HEADERS } from '../../../lib/booking/admin-auth.ts';
import { getBooking, applyChange, revokeTokensFor, recordToken, isImported } from '../../../lib/booking/store.ts';
import type { Payment } from '../../../lib/booking/store.ts';
import { getRoomConfig } from '../../../lib/booking/config-reader.ts';
import { deleteEvent } from '../../../lib/booking/calendar.ts';
import { squareConfig, PaymentError } from '../../../lib/booking/square.ts';
import { issueRefund } from '../../../lib/booking/refunds.ts';
import { refundFor } from '../../../lib/booking/policy.ts';
import { freshenOne } from '../../../lib/booking/reconcile.ts';
import { formatPence } from '../../../lib/booking/pricing.ts';
import { doorCodeFor } from '../../../lib/booking/event-format.ts';
import { issue } from '../../../lib/booking/token.ts';
import { confirmationEmail, cancellationEmail, send } from '../../../lib/booking/email.ts';

export const prerender = false;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...ADMIN_HEADERS },
  });

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const actor = verifySession(cookies.get(ADMIN_COOKIE)?.value);
  if (!actor) return json({ error: 'Not signed in.' }, 401);

  let body: Record<string, any>;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

  const ref = String(body.ref ?? '').trim();
  const action = String(body.action ?? '');
  const raw = await getBooking(ref);
  if (!raw) return json({ error: 'No such booking.' }, 404);
  // The refund box is capped by paidPence and the cancel path prices from it.
  const booking = await freshenOne(ref, raw);

  // Imported Acuity history (`17`) is a record, not something this system can act on:
  // no calendar event of ours, no payment of ours, no magic-link token to resend.
  // Every write action is refused; the booking still reads normally in the list.
  if (isImported(booking) && action !== 'note') {
    return json({
      error: 'This booking was imported from Acuity for reporting. It has no calendar event '
        + 'or payment in this system, so it cannot be amended, refunded, cancelled or resent. '
        + 'Notes are still allowed.',
    }, 409);
  }

  const room = await getRoomConfig(booking.room);
  const roomName = room?.shortName ?? booking.room;
  const start = booking.start.toDate();
  const summary = {
    reference: ref, roomName, start, end: booking.end.toDate(),
    durationMins: booking.durationMins, pricePence: booking.pricePence,
    customerName: booking.customer.name, customerEmail: booking.customer.email,
    manageUrl: new URL(`/bookings/${ref}`, canonicalOrigin(url.origin)).toString(),
    capacityNote: room?.capacityNote,
    doorCode: doorCodeFor(booking.customer.phone ?? ''),
  };

  if (action === 'note') {
    const note = String(body.note ?? '').trim().slice(0, 500);
    if (!note) return json({ error: 'A note is required.' }, 400);
    await applyChange({ ref, history: { action: `note: ${note}`, actor: 'admin', from: actor } });
    return json({ message: 'Note added.' });
  }

  if (action === 'resend') {
    // A fresh link, which revokes the old one -- the booker asked for this because
    // the old one is lost or broken, and leaving both live serves nobody.
    await revokeTokensFor(ref);
    const { token, jti } = issue(ref, booking.customer.email, booking.end.toDate());
    await recordToken(jti, ref, booking.customer.email);
    await send(confirmationEmail({ ...summary, manageUrl: `${summary.manageUrl}?t=${token}` }));
    await applyChange({ ref, history: { action: 'confirmation resent', actor: 'admin', from: actor } });
    return json({ message: `Confirmation resent to ${booking.customer.email}.` });
  }

  const cfg = squareConfig();
  if (!cfg) return json({ error: 'Square is not configured.' }, 500);

  if (action === 'refund') {
    const amountPence = Math.round(Number(body.amountPence));
    const reason = String(body.reason ?? '').trim().slice(0, 200);
    if (!Number.isFinite(amountPence) || amountPence <= 0) return json({ error: 'Invalid amount.' }, 400);
    if (amountPence > booking.paidPence) return json({ error: 'That is more than is held.' }, 400);
    if (!reason) return json({ error: 'A reason is required.' }, 400);
    const outcome = await issueRefund(cfg, {
      ref, payments: booking.payments, amountPence,
      historyLength: booking.history.length, keyPrefix: `${ref}:admin`,
      reason: `Admin refund: ${reason}`, ledgerReason: 'admin',
    });

    // Record what went through even on failure -- the money has left Square.
    if (outcome.entries.length) {
      await applyChange({
        ref, payments: outcome.entries,
        history: { action: `refunded ${formatPence(outcome.ok ? amountPence : outcome.refundedPence)}: ${reason}`, actor: 'admin', from: actor },
      });
    }
    if (!outcome.ok) {
      console.error('admin: refund failed', { ref, actor, error: String(outcome.error) });
      const err = outcome.error;
      return json({
        error: outcome.refundedPence > 0
          ? `Only ${formatPence(outcome.refundedPence)} could be refunded; it is recorded on the booking.`
          : err instanceof PaymentError ? err.message : 'Refund failed.',
      }, 502);
    }
    return json({
      message: `Refunded ${formatPence(amountPence)} across `
        + `${outcome.entries.length} payment${outcome.entries.length === 1 ? '' : 's'}.`,
    });
  }

  if (action === 'cancel') {
    if (booking.status !== 'confirmed') return json({ error: 'Not a confirmed booking.' }, 409);
    const decision = refundFor({
      paidPence: booking.paidPence, currentPence: booking.pricePence, start, change: 'cancel',
    }, new Date());

    let refundEntries: Omit<Payment, 'at'>[] = [];
    if (decision.refundPence > 0) {
      const outcome = await issueRefund(cfg, {
        ref, payments: booking.payments, amountPence: decision.refundPence,
        historyLength: booking.history.length, keyPrefix: `${ref}:admin-cancel`,
        reason: 'Cancelled by Meadowbrook', ledgerReason: 'cancel',
      });
      refundEntries = outcome.entries;
      if (!outcome.ok) {
        // Same rule as the booker-facing path: never release a slot we have not
        // refunded, because a rebooked slot makes the failure unrecoverable.
        console.error('admin: cancel refund failed', { ref, actor, error: String(outcome.error) });
        if (outcome.entries.length) {
          await applyChange({
            ref, payments: outcome.entries,
            history: {
              action: `partial refund ${outcome.refundedPence}p on failed cancellation`,
              actor: 'admin', from: actor,
            },
          }).catch((e) => console.error('admin: could not record partial refund', e));
        }
        return json({
          error: outcome.refundedPence > 0
            ? `Only ${formatPence(outcome.refundedPence)} of ${formatPence(decision.refundPence)} `
              + 'could be refunded, so the booking has not been cancelled. The part that went '
              + 'through is recorded on the booking.'
            : 'The refund failed, so the booking has not been cancelled.',
        }, 502);
      }
    }

    if (booking.calendarEventId && room) {
      await deleteEvent(room.calendarId, booking.calendarEventId)
        .catch((err) => console.error('admin: calendar delete failed', { ref, err: String(err) }));
    }
    await applyChange({
      ref, status: 'cancelled', calendarEventId: null,
      ...(refundEntries.length ? { payments: refundEntries } : {}),
      history: { action: 'cancelled by admin', actor: 'admin', from: actor },
    });
    await revokeTokensFor(ref).catch(() => undefined);
    await send(cancellationEmail(summary, decision.refundPence)).catch((err) =>
      console.error('admin: cancellation email failed', err));
    return json({
      message: decision.refundPence > 0
        ? `Cancelled and refunded ${formatPence(decision.refundPence)}.`
        : 'Cancelled. No refund was due.',
    });
  }

  return json({ error: 'Unknown action.' }, 400);
};
