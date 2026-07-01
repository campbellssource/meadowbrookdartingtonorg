import type { APIRoute } from 'astro';
import { isAdminAuthorized, AlreadyDrawnError, EmptyPoolError } from '../../../lib/raffle';
import { getPrizes, recordDraw, isRaffleSheetConfigured } from '../../../lib/raffle-sheet';

// Admin-only. Draws one prize: builds the eligible pool (honouring
// EXCLUDE_PREVIOUS_WINNERS), selects with crypto.randomInt, and records an audit
// row — all in raffle-sheet.recordDraw. Refuses a second draw for the same prize
// and errors cleanly on an empty pool.

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request }) => {
  if (!isAdminAuthorized(request)) {
    return json({ error: 'Not authorised.' }, 401);
  }
  if (!isRaffleSheetConfigured()) {
    return json({ error: 'The raffle is not available right now.' }, 503);
  }

  let prizeId = '';
  try {
    const b = await request.json();
    prizeId = String(b.prizeId ?? '').trim();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (!prizeId) return json({ error: 'Missing prize.' }, 400);

  const prize = (await getPrizes()).find((p) => p.id === prizeId);
  if (!prize) return json({ error: 'Unknown prize.' }, 404);

  try {
    const result = await recordDraw(prize, 'admin');
    return json({
      success: true,
      prizeId: result.prizeId,
      ticket: result.ticket,
      name: result.name,
      phone: result.phone,
      poolSize: result.poolSize,
    });
  } catch (err) {
    if (err instanceof AlreadyDrawnError) return json({ error: err.message }, 409);
    if (err instanceof EmptyPoolError) return json({ error: err.message }, 422);
    console.error('raffle draw error:', err);
    return json({ error: 'Something went wrong running the draw. Please try again.' }, 502);
  }
};
