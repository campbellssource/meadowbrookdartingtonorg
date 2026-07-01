// Optional confirmation email for a completed raffle entry, sent via Brevo's
// transactional email API. Gated by SEND_CONFIRMATION_EMAIL (off by default for
// the POC). Best-effort: never throws — a failed email must not fail the entry.
//
// The email is a receipt, so by law it carries the same four small-society
// lottery details as the on-screen ticket (society, price, organiser + address,
// draw date).

import {
  SEND_CONFIRMATION_EMAIL,
  SOCIETY_NAME,
  ORGANISER_NAME,
  ORGANISER_ADDRESS,
  DRAW_DATE_LABEL,
  TICKET_PRICE_LABEL,
} from './raffle';

const BREVO_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';
const SITE_URL = 'https://meadowbrookdartington.org';

function env(key: string): string | undefined {
  return process.env[key] ?? (import.meta.env as Record<string, string | undefined>)[key];
}

export async function sendConfirmationEmail(opts: {
  name: string;
  email: string;
  tickets: string[];
}): Promise<void> {
  if (!SEND_CONFIRMATION_EMAIL) return;

  const apiKey = env('BREVO_API_KEY');
  const fromEmail = env('RAFFLE_EMAIL_FROM') ?? 'contact@meadowbrookdartington.org';
  if (!apiKey) {
    console.warn('raffle-email: SEND_CONFIRMATION_EMAIL is on but BREVO_API_KEY is missing; skipping.');
    return;
  }

  const ticketList = opts.tickets.map((t) => `<li style="font-weight:700">${t}</li>`).join('');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#28201A;line-height:1.6">
      <h1 style="margin:0 0 12px">You're in the draw!</h1>
      <p>Thanks ${escapeHtml(opts.name || 'and good luck')} — here ${
        opts.tickets.length > 1 ? 'are your ticket numbers' : 'is your ticket number'
      }:</p>
      <ul>${ticketList}</ul>
      <p>Every ticket is entered in the draw for <strong>every</strong> prize. Winners are drawn
         live at the Meadowbrook Extravaganza on <strong>${DRAW_DATE_LABEL}</strong>.</p>
      <p>You can see your ticket on the public entries list:
         <a href="${SITE_URL}/entries">${SITE_URL}/entries</a></p>
      <hr style="border:none;border-top:1px solid #e6dccb;margin:20px 0" />
      <p style="font-size:12px;color:#5B4E42">
        <strong>Lottery information</strong><br />
        Promoting society: ${SOCIETY_NAME}<br />
        Organiser: ${ORGANISER_NAME}, ${ORGANISER_ADDRESS}<br />
        Ticket price: ${TICKET_PRICE_LABEL} per ticket<br />
        Date of draw: ${DRAW_DATE_LABEL}<br />
        Promoted as a small society lottery under the Gambling Act 2005.
      </p>
    </div>`;

  try {
    const res = await fetch(BREVO_EMAIL_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Meadowbrook Extravaganza Raffle', email: fromEmail },
        to: [{ email: opts.email, name: opts.name || undefined }],
        subject: `Your Extravaganza raffle ticket${opts.tickets.length > 1 ? 's' : ''}`,
        htmlContent: html,
      }),
    });
    if (!res.ok) {
      console.warn('raffle-email: Brevo send failed', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.warn('raffle-email: Brevo send threw', err);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}
