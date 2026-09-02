// Transactional email for bookings, via Brevo.
//
// Templates live here rather than in Brevo's UI: version-controlled, reviewable in
// a diff, testable without network, and impossible to break by someone editing a
// template in a vendor console. Every email ships a plain-text alternative.
//
// Two internal addresses, deliberately separate because they have different
// half-lives (`06`). `bookings@` gets a copy of everything and is expected to be
// switched off once the system is trusted; `it@` gets only failures and is never
// gated, because the day nobody reads every booking is the day alerts start
// mattering more.

import { formatPence } from './pricing.ts';
import { env } from './env.ts';
import { instantToLocalTime, toLondonISO } from './time.ts';

export const SENDER = { name: 'Meadowbrook Dartington', email: 'bookings@meadowbrookdartington.org' };
export const OWNER_EMAIL = 'bookings@meadowbrookdartington.org';
export const ALERT_EMAIL = 'it@meadowbrookdartington.org';

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
  ics?: string;
  replyTo?: string;
}

type Transport = 'console' | 'brevo';

/**
 * Never defaults to sending.
 *
 * Booking test data contains real addresses -- your own, and sooner or later a
 * real hirer's copied from a live booking while debugging. An unset variable
 * outside production is a mistake, and the safe reading of a mistake is "do not
 * email people".
 */
function transport(): Transport {
  const configured = env('BOOKING_EMAIL_TRANSPORT');
  if (process.env.NODE_ENV === 'production') {
    // The console transport prints the whole email, magic-link token included.
    // That is exactly right in development and a token leak into the logs in
    // production -- on top of nobody receiving their booking. Refused outright
    // rather than trusted to configuration.
    if (configured === 'console') {
      throw new Error('BOOKING_EMAIL_TRANSPORT=console is not permitted in production.');
    }
    return 'brevo';
  }
  if (configured === 'console' || configured === 'brevo') return configured;
  throw new Error(
    'BOOKING_EMAIL_TRANSPORT is not set. Use "console" in development (prints to the '
    + 'terminal) or "brevo" to actually send. Refusing to guess.',
  );
}

export async function send(email: Email): Promise<void> {
  if (transport() === 'console') {
    console.log(
      `\n${'─'.repeat(72)}\n  TO      ${email.to}\n  SUBJECT ${email.subject}\n`
      + `${'─'.repeat(72)}\n${email.text}\n${'─'.repeat(72)}`
      + (email.ics ? '\n  (an .ics attachment would be included)\n' : '\n'),
    );
    return;
  }

  const apiKey = env('BREVO_API_KEY');
  if (!apiKey) throw new Error('BREVO_API_KEY is not set but BOOKING_EMAIL_TRANSPORT=brevo');

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: email.to }],
      replyTo: { email: email.replyTo ?? OWNER_EMAIL },
      subject: email.subject,
      htmlContent: email.html,
      textContent: email.text,
      ...(email.ics ? {
        attachment: [{
          name: 'booking.ics',
          content: Buffer.from(email.ics, 'utf8').toString('base64'),
        }],
      } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo send failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}

// --- Formatting ----------------------------------------------------------

// en-GB renders "Wednesday, 14 October 2026". The comma is dropped because these
// dates are followed by a time -- "Wednesday, 14 October 2026, 19:00-20:30" reads
// as a list rather than a sentence.
const longDate = (d: Date): string => d.toLocaleDateString('en-GB', {
  timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).replace(',', '');

const shortDate = (d: Date): string => d.toLocaleDateString('en-GB', {
  timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
});

export interface BookingSummary {
  reference: string;
  roomName: string;
  start: Date;
  end: Date;
  durationMins: number;
  pricePence: number;
  customerName: string;
  customerEmail: string;
  manageUrl: string;
  capacityNote?: string;
  /** True when cancelling now would refund nothing -- booked inside the window. */
  nonRefundable?: boolean;
}

const durationWords = (mins: number): string => {
  const h = Math.floor(mins / 60); const m = mins % 60;
  return h && m ? `${h} hours ${m} minutes` : h ? `${h} hour${h > 1 ? 's' : ''}` : `${m} minutes`;
};

/**
 * Escapes user-supplied text for an HTML email body.
 *
 * The staff notification echoes a booker-typed name and email into `<pre>`. Mail
 * clients strip scripts, so this is not XSS -- but unescaped markup lets a booker
 * put a disguised link or spoofed system copy into the mail read by the people who
 * hold the admin session. Cheap to prevent. Found by /security-review, 2 Sep 2026.
 */
const esc = (s: string): string => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const wrap = (title: string, bodyHtml: string): string => `<!doctype html>
<html><body style="margin:0;padding:24px;background:#FBF0DF;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#28201A;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;">
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.25;">${title}</h1>
${bodyHtml}
<p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #F4E4CB;font-size:13px;color:#8B7C6E;">
Meadowbrook, Shinners Bridge, Dartington, TQ9 6JD<br>
<a href="mailto:${OWNER_EMAIL}" style="color:#4D7A33;">${OWNER_EMAIL}</a></p>
</div></body></html>`;

/**
 * The confirmation. The most important email in the system: it is the receipt, the
 * reminder, and the only way back into the booking.
 */
export function confirmationEmail(b: BookingSummary): Email {
  const when = `${longDate(b.start)}, ${instantToLocalTime(b.start)}–${instantToLocalTime(b.end)}`;
  const policy = b.nonRefundable
    ? 'Because this booking starts within the hour, it cannot be refunded if you cancel.'
    : 'You can cancel for a full refund up to 1 hour before the start time.';

  const text = [
    `Your booking is confirmed.`, '',
    `${b.roomName}`, `${when}`, `${durationWords(b.durationMins)}`,
    `Paid: ${formatPence(b.pricePence)}`,
    `Reference: ${b.reference}`, '',
    b.capacityNote ? `${b.capacityNote}\n` : '',
    `Change or cancel your booking:`, b.manageUrl, '',
    policy, '',
    `Meadowbrook, Shinners Bridge, Dartington, TQ9 6JD`,
    OWNER_EMAIL,
  ].filter((l) => l !== undefined).join('\n');

  const html = wrap('Your booking is confirmed', `
    <table style="width:100%;border-collapse:collapse;font-size:15px;">
      <tr><td style="padding:6px 0;color:#5B4E42;">Room</td><td style="padding:6px 0;font-weight:600;">${b.roomName}</td></tr>
      <tr><td style="padding:6px 0;color:#5B4E42;">When</td><td style="padding:6px 0;font-weight:600;">${when}</td></tr>
      <tr><td style="padding:6px 0;color:#5B4E42;">Length</td><td style="padding:6px 0;">${durationWords(b.durationMins)}</td></tr>
      <tr><td style="padding:6px 0;color:#5B4E42;">Paid</td><td style="padding:6px 0;font-weight:600;">${formatPence(b.pricePence)}</td></tr>
      <tr><td style="padding:6px 0;color:#5B4E42;">Reference</td><td style="padding:6px 0;font-family:ui-monospace,monospace;">${b.reference}</td></tr>
    </table>
    ${b.capacityNote ? `<p style="margin:18px 0 0;font-size:14px;color:#5B4E42;">${esc(b.capacityNote)}</p>` : ''}
    <p style="margin:24px 0 0;">
      <a href="${b.manageUrl}" style="display:inline-block;background:#74A953;color:#fff;text-decoration:none;padding:13px 22px;border-radius:999px;font-weight:600;">Change or cancel</a>
    </p>
    <p style="margin:18px 0 0;font-size:14px;color:#5B4E42;">${policy}</p>`);

  return {
    to: b.customerEmail,
    subject: `Your booking is confirmed — ${b.roomName}, ${shortDate(b.start)}, ${instantToLocalTime(b.start)}`,
    html, text, ics: icsFor(b),
  };
}

/**
 * Cancellation. States the refund in cash and how long it takes to appear.
 *
 * The "5 to 10 working days" line is the single most effective support-ticket
 * prevention in the system: without it, every cancellation risks a "where is my
 * money" email three days later.
 */
export function cancellationEmail(b: BookingSummary, refundPence: number): Email {
  const when = `${longDate(b.start)}, ${instantToLocalTime(b.start)}–${instantToLocalTime(b.end)}`;
  const money = refundPence > 0
    ? `We are refunding ${formatPence(refundPence)} to the card you paid with. `
      + `Refunds usually take 5 to 10 working days to appear on your statement.`
    : `No refund is due, because this booking was cancelled within an hour of its start time.`;
  const text = [
    'Your booking has been cancelled.', '',
    b.roomName, when, `Reference: ${b.reference}`, '',
    money, '',
    'If this was a mistake, please book again — we cannot reinstate a cancelled booking.',
  ].join('\n');
  return {
    to: b.customerEmail,
    subject: refundPence > 0
      ? `Booking cancelled — refund of ${formatPence(refundPence)} on its way`
      : `Booking cancelled — ${b.roomName}, ${shortDate(b.start)}`,
    html: wrap('Your booking has been cancelled', `
      <table style="width:100%;border-collapse:collapse;font-size:15px;">
        <tr><td style="padding:6px 0;color:#5B4E42;">Room</td><td style="padding:6px 0;font-weight:600;">${b.roomName}</td></tr>
        <tr><td style="padding:6px 0;color:#5B4E42;">Was</td><td style="padding:6px 0;">${when}</td></tr>
        <tr><td style="padding:6px 0;color:#5B4E42;">Reference</td><td style="padding:6px 0;font-family:ui-monospace,monospace;">${b.reference}</td></tr>
      </table>
      <p style="margin:20px 0 0;">${money}</p>`),
    text,
  };
}

/** Amendment. Shows what changed and what money moved, if any. */
export function amendmentEmail(b: BookingSummary, delta: { chargePence: number; refundPence: number }): Email {
  const when = `${longDate(b.start)}, ${instantToLocalTime(b.start)}–${instantToLocalTime(b.end)}`;
  const money = delta.chargePence > 0
    ? `We have charged a further ${formatPence(delta.chargePence)} for the longer booking.`
    : delta.refundPence > 0
      ? `We are refunding ${formatPence(delta.refundPence)}. Refunds usually take 5 to 10 working days to appear.`
      : 'The price is unchanged.';
  const text = [
    'Your booking has been changed.', '',
    b.roomName, `Now: ${when}`, `Total: ${formatPence(b.pricePence)}`,
    `Reference: ${b.reference}`, '', money, '',
    'Change or cancel again:', b.manageUrl,
  ].join('\n');
  return {
    to: b.customerEmail,
    subject: `Your booking has been changed — ${b.roomName}, ${shortDate(b.start)}, ${instantToLocalTime(b.start)}`,
    html: wrap('Your booking has been changed', `
      <table style="width:100%;border-collapse:collapse;font-size:15px;">
        <tr><td style="padding:6px 0;color:#5B4E42;">Room</td><td style="padding:6px 0;font-weight:600;">${b.roomName}</td></tr>
        <tr><td style="padding:6px 0;color:#5B4E42;">Now</td><td style="padding:6px 0;font-weight:600;">${when}</td></tr>
        <tr><td style="padding:6px 0;color:#5B4E42;">Total</td><td style="padding:6px 0;">${formatPence(b.pricePence)}</td></tr>
        <tr><td style="padding:6px 0;color:#5B4E42;">Reference</td><td style="padding:6px 0;font-family:ui-monospace,monospace;">${b.reference}</td></tr>
      </table>
      <p style="margin:20px 0 0;">${money}</p>
      <p style="margin:20px 0 0;"><a href="${b.manageUrl}" style="color:#4D7A33;">Change or cancel again</a></p>`),
    text, ics: icsFor(b, 1),
  };
}

/** Links to your upcoming bookings, for someone who lost the email. */
export function findLinksEmail(to: string, items: { roomName: string; start: Date; url: string }[]): Email {
  const lines = items.map((i) => `${i.roomName} — ${longDate(i.start)}, ${instantToLocalTime(i.start)}\n${i.url}`);
  const text = ['Here are your upcoming Meadowbrook bookings.', '', ...lines].join('\n\n');
  return {
    to,
    subject: 'Your Meadowbrook booking links',
    html: wrap('Your bookings', items.map((i) => `
      <p style="margin:0 0 16px;"><strong>${i.roomName}</strong><br>
      ${longDate(i.start)}, ${instantToLocalTime(i.start)}<br>
      <a href="${i.url}" style="color:#4D7A33;">Open this booking</a></p>`).join('')),
    text,
  };
}

/** Copy to the DRA. Gated by BOOKING_NOTIFY_OWNER so it can be switched off later. */
export function ownerNotificationEmail(b: BookingSummary, action: 'New' | 'Amended' | 'Cancelled'): Email {
  const when = `${longDate(b.start)}, ${instantToLocalTime(b.start)}–${instantToLocalTime(b.end)}`;
  const text = [
    `${action} booking`, '',
    `${b.roomName}`, `${when}`,
    `${b.customerName} <${b.customerEmail}>`,
    `${formatPence(b.pricePence)}`,
    `Reference: ${b.reference}`,
  ].join('\n');
  return {
    to: OWNER_EMAIL,
    subject: `[Booking] ${action} — ${b.roomName}, ${shortDate(b.start)}`,
    html: wrap(`${action} booking`, `<pre style="font-family:inherit;white-space:pre-wrap;margin:0;">${esc(text)}</pre>`),
    text,
  };
}

/** Failures go to it@, ungated, and never carry card data. */
export function alertEmail(subject: string, lines: string[]): Email {
  const text = lines.join('\n');
  return {
    to: ALERT_EMAIL,
    subject: `[Booking]${subject}`,
    html: wrap(subject, `<pre style="font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap;margin:0;">${esc(text)}</pre>`),
    text,
  };
}

/**
 * An .ics so the booking lands in the hirer's own calendar.
 *
 * UID is the booking reference and SEQUENCE starts at 0, so a later amendment
 * updates the same entry rather than leaving two.
 */
export function icsFor(b: BookingSummary, sequence = 0): string {
  const stamp = (d: Date) => `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
  const esc = (s: string) => s.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Meadowbrook Dartington//Booking//EN',
    'METHOD:REQUEST', 'BEGIN:VEVENT',
    `UID:${b.reference}@meadowbrookdartington.org`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(b.start)}`,
    `DTEND:${stamp(b.end)}`,
    `SUMMARY:${esc(`${b.roomName} — Meadowbrook`)}`,
    `DESCRIPTION:${esc(`Booking ${b.reference}\nChange or cancel: ${b.manageUrl}`)}`,
    'LOCATION:Meadowbrook, Shinners Bridge, Dartington, TQ9 6JD',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}
