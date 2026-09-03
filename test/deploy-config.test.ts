import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A missing environment variable in production does not fail the build or the
// deploy -- it fails at runtime, quietly, in whichever branch reads it. Firestore
// access disappears, or emails stop, or the admin locks everyone out. This test
// compares what the code reads against what the deploy actually supplies.

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|astro)$/.test(e)) out.push(full);
  }
  return out;
}

const sources = [
  ...walk('src/lib/booking'),
  ...walk('src/pages/api/booking'),
  ...walk('src/pages/api/admin'),
  ...walk('src/pages/admin'),
  ...walk('src/pages/bookings'),
  'src/components/BookingWidget.astro',
];

function readsEnv(): Set<string> {
  const found = new Set<string>();
  for (const f of sources) {
    const src = readFileSync(f, 'utf8');
    for (const re of [/env\('([A-Z_]+)'\)/g, /envBool\('([A-Z_]+)'/g,
                      /process\.env\.([A-Z_]+)/g, /import\.meta\.env\.([A-Z_]+)/g]) {
      for (const m of src.matchAll(re)) found.add(m[1]);
    }
  }
  return found;
}

const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');

function supplied(): Set<string> {
  const out = new Set<string>();
  const env = workflow.match(/--update-env-vars="([^"]+)"/)?.[1] ?? '';
  const sec = workflow.match(/--update-secrets="([^"]+)"/)?.[1] ?? '';
  for (const part of env.split('|')) {
    const name = part.split('=')[0].replace(/^\^/, '');
    if (/^[A-Z_]+$/.test(name)) out.add(name);
  }
  for (const part of sec.split(',')) out.add(part.split('=')[0]);
  return out;
}

// Absent from production on purpose. Each entry is a decision, not an oversight.
const DELIBERATELY_ABSENT: Record<string, string> = {
  BOOKING_EMAIL_TRANSPORT: 'production refuses "console" and defaults to brevo',
  BOOKING_ADMIN_DEV_LOGIN: 'refused outright when NODE_ENV=production',
  BOOKING_CRON_ALLOW_SECRET: 'Cloud Scheduler uses OIDC; the secret fallback stays off',
  FIRESTORE_EMULATOR_HOST: 'local development only',
  GOOGLE_SERVICE_ACCOUNT_JSON: 'the Workspace blocks key downloads; impersonation is used',
  NODE_ENV: 'set by the container image',
};

describe('the deploy supplies what the code reads', () => {
  test('no booking variable is left unset in production', () => {
    const missing = [...readsEnv()]
      .filter((v) => !supplied().has(v) && !(v in DELIBERATELY_ABSENT))
      .sort();
    assert.deepEqual(missing, [],
      `These are read at runtime but never set by the deploy: ${missing.join(', ')}. `
      + 'Add them to .github/workflows/deploy.yml, or to DELIBERATELY_ABSENT with a reason.');
  });

  test('impersonation is set in production, which is easy to assume it is not', () => {
    // The Cloud Run runtime SA has no roles on meadowbrook-booking and the room
    // calendars are shared with booking-app, so unset means every read fails.
    assert.match(workflow, /BOOKING_IMPERSONATE_SA=booking-app@meadowbrook-booking/);
  });

  test('the dev-only escape hatches are never deployed', () => {
    for (const v of ['BOOKING_ADMIN_DEV_LOGIN', 'BOOKING_EMAIL_TRANSPORT']) {
      assert.ok(!supplied().has(v), `${v} must not be set by the deploy: ${DELIBERATELY_ABSENT[v]}`);
    }
  });

  test('every mounted secret is one the setup script creates', () => {
    const script = readFileSync('spec/booking/setup-secrets.sh', 'utf8');
    const sec = workflow.match(/--update-secrets="([^"]+)"/)?.[1] ?? '';
    const orphans = sec.split(',').map((s) => s.split('=')[0])
      .filter((name) => !script.includes(name));
    assert.deepEqual(orphans, [],
      `The deploy mounts ${orphans.join(', ')} but setup-secrets.sh never creates them.`);
  });
});
