#!/usr/bin/env node
/**
 * Seeds a few sample prizes into the raffle Google Sheet's "Prizes" tab so the
 * /raffle page and /admin draw have something to show. Idempotent: it writes the
 * header + sample rows at the top of the tab, so re-running overwrites rather
 * than duplicating. Edit the SAMPLE_PRIZES list (or the sheet directly) for real.
 *
 * Requires the same env the app uses:
 *   RAFFLE_SHEET_ID                the raffle spreadsheet id
 *   GOOGLE_SERVICE_ACCOUNT_JSON    service-account key JSON, OR
 *   RAFFLE_IMPERSONATE_SA          a service account to impersonate via ADC
 *                                  (local-dev path on this managed domain), OR
 *                                  neither → plain ADC (Cloud Run runtime SA).
 *
 * Usage:  set -a && . .env && set +a && node scripts/seed-raffle-prizes.mjs
 */

import { GoogleAuth, Impersonated } from 'google-auth-library';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const TAB = 'Prizes';
const HEADER = ['id', 'name', 'description', 'donor', 'display_order'];

// Sample prizes — replace with the real ones (or edit them in the sheet).
const SAMPLE_PRIZES = [
  ['hamper', 'Family Hamper', 'A basket of local produce and treats.', 'Dartington Village Shop', '1'],
  ['meal-for-two', 'Meal for Two', 'Dinner for two at a local pub.', 'The Cott Inn', '2'],
  ['pool-passes', 'Season Pool Passes', 'A summer of swimming once the pool reopens.', 'Meadowbrook DRA', '3'],
  ['garden-voucher', '£50 Garden Voucher', 'Towards plants for the season.', 'Riverford', '4'],
  ['afternoon-tea', 'Afternoon Tea for Two', 'A treat for two at Dartington.', 'Dartington Hall', '5'],
  ['cider-case', 'Case of Local Cider', 'Twelve bottles of Devon cider.', 'Sandford Orchards', '6'],
  ['pizza-night', 'Pizza Night for Four', 'Wood-fired pizzas for the family.', 'Pizzalogica', '7'],
  ['sauna-pass', 'Month of Sauna Sessions', 'A month of wood-fired sauna at Meadowbrook.', 'The Somewhere Sauna', '8'],
];

const sheetId = process.env.RAFFLE_SHEET_ID;
if (!sheetId) {
  console.error('RAFFLE_SHEET_ID not set. Aborting.');
  process.exit(1);
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const auth = new GoogleAuth({
  scopes: SCOPES,
  credentials: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : undefined, // falls back to ADC
});

let impClient = null;
async function getToken() {
  const impersonate = process.env.RAFFLE_IMPERSONATE_SA;
  if (impersonate && !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    if (!impClient) {
      impClient = new Impersonated({
        sourceClient: await auth.getClient(),
        targetPrincipal: impersonate,
        lifetime: 3600,
        delegates: [],
        targetScopes: SCOPES,
      });
    }
    return (await impClient.getAccessToken()).token;
  }
  return auth.getAccessToken();
}

async function authedFetch(url, init) {
  const token = await getToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res;
}

async function ensureTab() {
  const res = await authedFetch(`${SHEETS_BASE}/${sheetId}?fields=sheets.properties(title)`);
  const data = await res.json();
  const exists = (data.sheets ?? []).some(
    (s) => String(s?.properties?.title ?? '').toLowerCase() === TAB.toLowerCase()
  );
  if (!exists) {
    await authedFetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }),
    });
    console.log(`Created "${TAB}" tab.`);
  }
}

async function seed() {
  await ensureTab();
  const values = [HEADER, ...SAMPLE_PRIZES];
  const lastCol = String.fromCharCode(64 + HEADER.length);
  const range = encodeURIComponent(`'${TAB}'!A1:${lastCol}${values.length}`);
  await authedFetch(`${SHEETS_BASE}/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values }),
  });
  console.log(`Seeded ${SAMPLE_PRIZES.length} prizes into "${TAB}".`);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
