#!/usr/bin/env node
/**
 * Seeds the raffle's Prizes and Settings tabs so /raffle and /admin have data.
 * Idempotent: writes header + rows at the top of each tab, so re-running
 * overwrites rather than duplicating. Edit the lists below (or the sheet).
 *
 * Targets the prizes spreadsheet: RAFFLE_PRIZES_SHEET_ID if set, else
 * RAFFLE_SHEET_ID (single-sheet fallback).
 *
 * Requires the same auth the app uses:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  service-account key JSON, OR
 *   RAFFLE_IMPERSONATE_SA        a service account to impersonate via ADC, OR
 *                                neither → plain ADC (Cloud Run runtime SA).
 *
 * Usage:  set -a && . .env && set +a && node scripts/seed-raffle-prizes.mjs
 */

import { GoogleAuth, Impersonated } from 'google-auth-library';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const PRIZES_HEADER = ['id', 'name', 'description', 'donor', 'display_order', 'star', 'donor_url'];
// display_order 1 = the star (headline) prize — shown first, drawn LAST.
const SAMPLE_PRIZES = [
  ['grand-prize', 'Grand Prize: Weekend for Two', 'A two-night Devon getaway for two.', 'Dartington Hall', '1', 'TRUE', 'https://www.dartington.org'],
  ['hamper', 'Family Hamper', 'A basket of local produce and treats.', 'Dartington Village Shop', '2', '', ''],
  ['meal-for-two', 'Meal for Two', 'Dinner for two at a local pub.', 'The Cott Inn', '3', '', 'https://www.cottinn.co.uk'],
  ['pool-passes', 'Season Pool Passes', 'A summer of swimming once the pool reopens.', 'Meadowbrook DRA', '4', '', 'https://meadowbrookdartington.org'],
  ['afternoon-tea', 'Afternoon Tea for Two', 'A treat for two at Dartington.', 'Dartington Hall', '5', '', 'https://www.dartington.org'],
  ['cider-case', 'Case of Local Cider', 'Twelve bottles of Devon cider.', 'Sandford Orchards', '6', '', 'https://www.sandfordorchards.co.uk'],
  ['pizza-night', 'Pizza Night for Four', 'Wood-fired pizzas for the family.', 'Pizzalogica', '7', '', 'https://meadowbrookdartington.org/facilities/pizzalogica'],
  ['sauna-pass', 'Month of Sauna Sessions', 'A month of wood-fired sauna at Meadowbrook.', 'The Somewhere Sauna', '8', '', 'https://meadowbrookdartington.org/facilities/somewhere-sauna'],
];

const SETTINGS_HEADER = ['key', 'value'];
// entry_deadline: ISO 8601 WITH offset. +01:00 = BST. Edit freely in the sheet.
const SETTINGS = [
  ['entry_deadline', '2026-07-03T18:00:00+01:00'],
];

const sheetId = process.env.RAFFLE_PRIZES_SHEET_ID || process.env.RAFFLE_SHEET_ID;
if (!sheetId) {
  console.error('Neither RAFFLE_PRIZES_SHEET_ID nor RAFFLE_SHEET_ID is set. Aborting.');
  process.exit(1);
}

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const auth = new GoogleAuth({
  scopes: SCOPES,
  credentials: process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    : undefined,
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

async function ensureTab(title) {
  const res = await authedFetch(`${SHEETS_BASE}/${sheetId}?fields=sheets.properties(title)`);
  const data = await res.json();
  const exists = (data.sheets ?? []).some(
    (s) => String(s?.properties?.title ?? '').toLowerCase() === title.toLowerCase()
  );
  if (!exists) {
    await authedFetch(`${SHEETS_BASE}/${sheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    });
    console.log(`Created "${title}" tab.`);
  }
}

async function writeTab(title, header, rows) {
  await ensureTab(title);
  const values = [header, ...rows];
  const lastCol = String.fromCharCode(64 + header.length);
  const range = encodeURIComponent(`'${title}'!A1:${lastCol}${values.length}`);
  await authedFetch(`${SHEETS_BASE}/${sheetId}/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values }),
  });
  console.log(`Seeded ${rows.length} row(s) into "${title}".`);
}

async function seed() {
  await writeTab('Prizes', PRIZES_HEADER, SAMPLE_PRIZES);
  await writeTab('Settings', SETTINGS_HEADER, SETTINGS);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
