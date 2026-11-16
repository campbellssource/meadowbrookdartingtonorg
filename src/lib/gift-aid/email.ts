// Donation and Gift Aid emails.
//
// Sent through the booking system's `send()`, so the same rules hold: printed to
// the terminal in development, refused as `console` in production, never sent by
// accident from a test. Every email that confirms a declaration says how to cancel
// or change it -- HMRC expects donors to be told, and it is the honest thing to do
// with a promise that runs for years.

import type { Email } from '../booking/email.ts';
import { CHARITY_NAME, CHARITY_NUMBER, CONTACT_EMAIL, UPDATE_NOTICE, formatPounds, giftAidOn } from './declaration.ts';
import { VERBAL_CANCEL_DAYS } from './retention.ts';
import type { Declaration, Donation } from './types.ts';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function addressLines(d: Declaration): string[] {
  const name = [d.title, d.firstName, d.lastName].filter(Boolean).join(' ');
  return [name, `${d.houseNameOrNumber} ${d.addressLine}`, d.town, d.postcode];
}

const scopeLine = (d: Declaration): string => (d.scope === 'Enduring'
  ? 'This declaration covers this donation, any you have made in the past 4 years and any you make in the future, until you tell us otherwise.'
  : 'This declaration covers this donation only.');

const howToChange = `${UPDATE_NOTICE} Just reply to this email, or write to ${CONTACT_EMAIL}.`;

function wrap(paragraphs: string[]): string {
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#2d2d2d;max-width:560px">${
    paragraphs.join('')}<p style="color:#7a6f66;font-size:13px">${esc(CHARITY_NAME)}, registered charity ${CHARITY_NUMBER}.</p></div>`;
}

const p = (s: string): string => `<p>${esc(s)}</p>`;
const quote = (s: string): string =>
  `<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #74A953;background:#f4f8ef">${esc(s)}</blockquote>`;

export function thankYouEmail(to: string, donation: Donation, declaration: Declaration | null, firstName: string): Email {
  const amount = formatPounds(donation.amountPence);
  const lines: string[] = [
    `Dear ${firstName},`,
    `Thank you so much for your donation of ${amount} to Meadowbrook${donation.campaign === 'Pool appeal' ? ' and the pool appeal' : ''}. It goes straight into keeping the site open for the whole community.`,
  ];
  const html: string[] = [p(lines[0]), p(lines[1])];

  if (declaration) {
    const boost = formatPounds(giftAidOn(donation.amountPence));
    const extra = [
      `You also made a Gift Aid declaration, which means we can claim an extra ${boost} from HMRC at no cost to you. Here is what you declared, so you have a copy:`,
    ];
    lines.push(extra[0], declaration.wordingText, scopeLine(declaration), 'We recorded your name and home address as:', ...addressLines(declaration), howToChange);
    html.push(p(extra[0]), quote(declaration.wordingText), p(scopeLine(declaration)),
      p('We recorded your name and home address as:'),
      `<p>${addressLines(declaration).map(esc).join('<br>')}</p>`, p(howToChange));
  }
  lines.push('With thanks,', 'The Dartington Recreation Association');
  html.push(p('With thanks,'), p('The Dartington Recreation Association'));

  return {
    to,
    subject: declaration ? 'Thank you for your donation, and your Gift Aid declaration' : 'Thank you for your donation',
    text: [...lines, '', `${CHARITY_NAME}, registered charity ${CHARITY_NUMBER}.`].join('\n\n'),
    html: wrap(html),
    replyTo: CONTACT_EMAIL,
  };
}

/** The written record a verbal declaration needs before it can be claimed on. */
export function verbalConfirmationEmail(to: string, d: Declaration): Email {
  const intro = `Thank you for telling us on ${new Date(`${d.madeOn}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} that you would like to Gift Aid your donations to ${CHARITY_NAME}. This is our written record of that declaration.`;
  const cancel = `If this is not right, or you change your mind, you can cancel it within ${VERBAL_CANCEL_DAYS} days of this email and it will be treated as though you never made it. You can also cancel at any time after that, for future donations.`;
  const lines = [
    `Dear ${d.firstName},`, intro, d.wordingText, scopeLine(d),
    'We recorded your name and home address as:', ...addressLines(d), cancel, howToChange,
    'With thanks,', 'The Dartington Recreation Association',
  ];
  return {
    to,
    subject: 'Your Gift Aid declaration: our written record',
    text: [...lines, '', `${CHARITY_NAME}, registered charity ${CHARITY_NUMBER}.`].join('\n\n'),
    html: wrap([
      p(lines[0]), p(intro), quote(d.wordingText), p(scopeLine(d)),
      p('We recorded your name and home address as:'),
      `<p>${addressLines(d).map(esc).join('<br>')}</p>`, p(cancel), p(howToChange),
      p('With thanks,'), p('The Dartington Recreation Association'),
    ]),
    replyTo: CONTACT_EMAIL,
  };
}
