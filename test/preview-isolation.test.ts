import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// PR previews take sandbox donations end to end. That is only safe while every
// store they touch is a test one. A preview is built from unreviewed PR code, so
// these are the lines that must never drift into production's.

const preview = readFileSync('.github/workflows/preview.yml', 'utf8');
const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
const PRODUCTION_SHEET = '1h-eMAKXv22b9oTQzXqg9RKh4y0t9ZeMOhcBfLh3VBRE';

describe('PR previews stay away from production data and money', () => {
  test('the Square token is the sandbox one, never the live secret', () => {
    assert.match(preview, /--update-secrets=SQUARE_ACCESS_TOKEN=PREVIEW_SQUARE_ACCESS_TOKEN:latest/);
    assert.doesNotMatch(preview, /SQUARE_ACCESS_TOKEN=SQUARE_ACCESS_TOKEN/);
    assert.doesNotMatch(preview, /BOOKING_SQUARE_ACCESS_TOKEN/);
    assert.match(preview, /PUBLIC_SQUARE_ENVIRONMENT=sandbox/);
    assert.doesNotMatch(preview, /connect\.squareup\.com/, 'previews may only call the sandbox API');
  });

  test('Firestore is the preview database, reached without the production identity', () => {
    assert.match(preview, /BOOKING_FIRESTORE_DATABASE=preview/);
    assert.doesNotMatch(preview, /BOOKING_IMPERSONATE_SA/, 'booking-app can reach production data');
  });

  test('Gift Aid rows go to the test sheet, not the bookkeeper\'s', () => {
    assert.match(preview, /GIFT_AID_SHEET_ID=10r2WxQTAPvy7zXNRN-9wdGQR3kGXcTAod5ba4A9E5Ng/);
    assert.ok(!preview.includes(PRODUCTION_SHEET));
    assert.doesNotMatch(preview, /GIFT_AID_SHEETS_IMPERSONATE_SA/);
  });

  test('previews cannot send email', () => {
    assert.doesNotMatch(preview, /BREVO_API_KEY/);
  });

  test('production never names a database, so it always uses the default one', () => {
    assert.doesNotMatch(deploy, /BOOKING_FIRESTORE_DATABASE/);
  });
});
