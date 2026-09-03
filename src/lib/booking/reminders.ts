// The day-before reminder.

import { Timestamp } from '@google-cloud/firestore';
import { getDb } from './store.ts';
import type { Booking } from './store.ts';
import { getRoomConfig } from './config-reader.ts';
import { issue } from './token.ts';
import { recordToken } from './store.ts';
import { send, HOUSEKEEPING, type Email } from './email.ts';
import { formatPence } from './pricing.ts';
import { instantToLocalTime } from './time.ts';
import { doorCodeFor } from './event-format.ts';

export interface ReminderReport { sent: number; skipped: number; failed: number }

function reminderEmail(args: {
  to: string; roomName: string; start: Date; end: Date; pricePence: number;
  reference: string; manageUrl: string; capacityNote?: string; doorCode?: string | null;
}): Email {
  const when = `${instantToLocalTime(args.start)}–${instantToLocalTime(args.end)}`;
  const text = [
    `Tomorrow: ${args.roomName}, ${when}.`, '',
    args.doorCode ? `Your door code is ${args.doorCode}.` : '',
    args.capacityNote ?? '', '',
    `Reference: ${args.reference}`,
    `Paid: ${formatPence(args.pricePence)}`, '',
    'Need to change or cancel?', args.manageUrl,
    'You can cancel for a full refund up to 1 hour before the start.', '',
    HOUSEKEEPING,
  ].filter(Boolean).join('\n');

  return {
    to: args.to,
    subject: `Tomorrow: ${args.roomName}, ${when}`,
    text,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#FBF0DF;font-family:system-ui,sans-serif;color:#28201A;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
<h1 style="margin:0 0 16px;font-size:22px;">Tomorrow: ${args.roomName}</h1>
<p style="font-size:17px;font-weight:600;margin:0 0 14px;">${when}</p>
${args.doorCode ? `<p style="margin:0 0 14px;">Your door code is <strong style="font-family:ui-monospace,monospace;">${args.doorCode}</strong>.</p>` : ''}
${args.capacityNote ? `<p style="font-size:14px;color:#5B4E42;margin:0 0 14px;">${args.capacityNote}</p>` : ''}
<p style="margin:20px 0 0;"><a href="${args.manageUrl}" style="display:inline-block;background:#74A953;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;">Change or cancel</a></p>
<p style="font-size:13px;color:#8B7C6E;margin:18px 0 0;">Reference ${args.reference} · paid ${formatPence(args.pricePence)}</p>
<p style="margin:16px 0 0;padding-top:14px;border-top:1px solid #F4E4CB;font-size:13px;color:#8B7C6E;line-height:1.55;">${HOUSEKEEPING}</p>
</div></body></html>`,
  };
}

/**
 * Sends reminders for bookings starting in the next 24 to 48 hours.
 *
 * The window is wider than a day and `reminderSentAt` is stamped, so the job can
 * be run twice, run late, or miss a day without either double-sending or silently
 * skipping someone.
 */
export async function sendReminders(origin: string, now = new Date()): Promise<ReminderReport> {
  const db = await getDb();
  const report: ReminderReport = { sent: 0, skipped: 0, failed: 0 };

  const from = new Date(now.getTime() + 12 * 3600_000);
  const to = new Date(now.getTime() + 48 * 3600_000);
  const snap = await db.collection('bookings')
    .where('start', '>=', Timestamp.fromDate(from))
    .where('start', '<=', Timestamp.fromDate(to))
    .get();

  for (const doc of snap.docs) {
    const b = doc.data() as Booking & { reminderSentAt?: Timestamp | null };
    if (b.status !== 'confirmed') { report.skipped += 1; continue; }
    // Imported Acuity bookings (`17`). Acuity sent its own reminders at the time, and
    // these people never gave us their address for this system to email them from.
    if (b.source === 'acuity') { report.skipped += 1; continue; }
    if (b.reminderSentAt) { report.skipped += 1; continue; }
    // A booking made after the reminder would have gone out does not need one:
    // the confirmation email is minutes old and says the same things.
    if (b.createdAt.toDate() > from) { report.skipped += 1; continue; }

    try {
      const room = await getRoomConfig(b.room);
      const { token, jti } = issue(doc.id, b.customer.email, b.end.toDate());
      await recordToken(jti, doc.id, b.customer.email);
      await send(reminderEmail({
        to: b.customer.email,
        roomName: room?.shortName ?? b.room,
        start: b.start.toDate(), end: b.end.toDate(),
        pricePence: b.pricePence, reference: doc.id,
        manageUrl: `${origin}/bookings/${doc.id}?t=${token}`,
        capacityNote: room?.capacityNote,
        doorCode: doorCodeFor(b.customer.phone ?? ''),
      }));
      await doc.ref.update({ reminderSentAt: Timestamp.now() });
      report.sent += 1;
    } catch (err) {
      report.failed += 1;
      console.error('reminders: failed', { ref: doc.id, err: String(err) });
    }
  }

  return report;
}
