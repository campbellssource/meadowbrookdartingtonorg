// CSV export for the treasurer.
//
// Served over an authenticated request and never written anywhere public: this is
// every booker's name, email and phone number in one file.

import type { APIRoute } from 'astro';
import { verifySession, ADMIN_COOKIE, ADMIN_HEADERS } from '../../../lib/booking/admin-auth.ts';
import { listBookings } from '../../../lib/booking/store.ts';
import { instantToLocalTime } from '../../../lib/booking/time.ts';

export const prerender = false;

/**
 * Prefixed if it could be read as a formula — a CSV opened in Excel is executable.
 *
 * The test ignores leading whitespace, because Excel and Sheets do too: `" =CMD"`
 * is parsed as a formula while a first-character check sees a space and passes it
 * through. Also covers the non-breaking space, which survives a copy-paste from a
 * web page and is not matched by `\s`.
 */
const FORMULA_START = /^[\s\u00a0]*[=+\-@\t\r]/;

const cell = (v: unknown): string => {
  const s = String(v ?? '');
  const safe = FORMULA_START.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const actor = verifySession(cookies.get(ADMIN_COOKIE)?.value);
  if (!actor) return new Response('Not signed in.', { status: 401 });

  const p = url.searchParams;
  const view = p.get('view') ?? 'upcoming';
  const now = new Date();
  const from = view === 'past' ? new Date(now.getTime() - 365 * 86400000) : now;
  const to = view === 'past' ? now : new Date(now.getTime() + 365 * 86400000);

  const rows = await listBookings(from, to);
  const header = [
    'Reference', 'Status', 'Room', 'Date', 'Start', 'End', 'Duration (mins)',
    'Price (£)', 'Paid (£)', 'Name', 'Email', 'Phone',
    'Charges (£)', 'Refunds (£)', 'Square payment id', 'Created',
  ];

  const lines = [header.map(cell).join(',')];
  for (const { ref, booking: b } of rows) {
    if (p.get('room') && b.room !== p.get('room')) continue;
    if (p.get('status') && b.status !== p.get('status')) continue;
    const charges = b.payments.filter((x) => x.kind === 'charge' && x.status === 'completed')
      .reduce((s, x) => s + x.amountPence, 0);
    const refunds = b.payments.filter((x) => x.kind === 'refund' && x.status === 'completed')
      .reduce((s, x) => s + x.amountPence, 0);
    lines.push([
      ref, b.status, b.room, b.localDate,
      instantToLocalTime(b.start.toDate()), instantToLocalTime(b.end.toDate()),
      b.durationMins, (b.pricePence / 100).toFixed(2), (b.paidPence / 100).toFixed(2),
      b.customer.name, b.customer.email, b.customer.phone ?? '',
      (charges / 100).toFixed(2), (refunds / 100).toFixed(2),
      b.payments[0]?.squarePaymentId ?? '', b.createdAt.toDate().toISOString(),
    ].map(cell).join(','));
  }

  console.log('admin: csv export', { actor, rows: lines.length - 1 });
  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      ...ADMIN_HEADERS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="meadowbrook-bookings-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
};
