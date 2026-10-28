import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  TABS, declarationRow, donationRow, smallDonationRow, inputRange, asText, asPounds, cellMatches,
} from '../src/lib/gift-aid/sheet-rows.ts';
import { syncRecord, checkUpdatedRange } from '../src/lib/gift-aid/sheets.ts';
import type { SheetsApi } from '../src/lib/gift-aid/sheets.ts';
import { syncPending } from '../src/lib/gift-aid/sync.ts';
import { validateDeclaration } from '../src/lib/gift-aid/validate.ts';
import { buildDeclaration, buildOfflineDonation, buildSmallDonation } from '../src/lib/gift-aid/records.ts';
import { freshSync } from '../src/lib/gift-aid/types.ts';
import type { Declaration } from '../src/lib/gift-aid/types.ts';
import { memoryStore } from './gift-aid-memory-store.ts';

// The bookkeeper's sheet has formula columns immediately to the right of the input
// columns. A row one cell too wide, or in the wrong order, silently breaks every
// claim calculation below it -- so width, order and escaping are pinned here, along
// with "a failure never loses a record" and "a retry never appends twice".

const NOW = new Date('2026-10-25T10:00:00Z');

function declaration(over: Record<string, unknown> = {}): Declaration {
  const r = validateDeclaration({
    optIn: true, title: 'Mrs', firstName: 'Jane', lastName: 'Smith-Jones', houseNameOrNumber: '12',
    addressLine: 'Example Road', town: 'Dartington', postcode: 'TQ9 6EJ', email: 'jane@example.com',
    scope: 'Enduring', madeOn: '2026-10-18', ...over,
  }, { method: 'Paper', now: NOW });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  return buildDeclaration((r as { value: any }).value, { enteredBy: 'treasurer@meadowbrookdartington.org', now: NOW, id: 'GA-7K2QX4' });
}

describe('column order: exactly the sheet\'s input columns', () => {
  test('Declarations!A:R', () => {
    assert.equal(inputRange('declaration'), 'Declarations!A:R');
    assert.deepEqual(TABS.declaration.headers, [
      'Declaration ID', 'Title', 'First name', 'Last name', 'House name or number', 'Address', 'Town',
      'Postcode', 'Email', 'Scope', 'Method', 'Date made', 'Wording version', 'Confirmation sent (verbal only)',
      'Cancelled date', 'Scan link', 'Entered by', 'Notes',
    ]);
    assert.equal(TABS.declaration.headers.length, 18); // A..R
  });

  test('Donations!A:K', () => {
    assert.equal(inputRange('donation'), 'Donations!A:K');
    assert.deepEqual(TABS.donation.headers, [
      'Donation ID', 'Declaration ID', 'Date received', 'Amount (£)', 'Method', 'Campaign', 'Source',
      'Via platform (Y/N)', 'Status', 'Claim ID', 'Notes',
    ]);
    assert.equal(TABS.donation.headers.length, 11); // A..K
  });

  test("'Small donations'!A:G", () => {
    assert.equal(inputRange('small'), "'Small donations'!A:G");
    assert.deepEqual(TABS.small.headers, [
      'Date collected', 'Event or place', 'Amount (£)', 'Cash or contactless', 'In Meadowbrook building (Y/N)',
      'Entered by', 'Notes',
    ]);
  });
});

describe('row mapping', () => {
  test('a declaration row, cell by cell', () => {
    const d = declaration({ scanLink: 'https://drive.google.com/file/d/abc/view', notes: 'Signed at the fete' });
    assert.deepEqual(declarationRow(d), [
      "'GA-7K2QX4", "'Mrs", "'Jane", "'Smith-Jones", "'12", "'Example Road", "'Dartington", "'TQ9 6EJ",
      "'jane@example.com", 'Enduring', 'Paper', '2026-10-18', "'v1", '', '', "'https://drive.google.com/file/d/abc/view",
      "'treasurer@meadowbrookdartington.org", "'Signed at the fete",
    ]);
  });

  test('house numbers stay text, so 12 is not a number and 1/2 is not a date', () => {
    assert.equal(declarationRow(declaration({ houseNameOrNumber: '12' }))[4], "'12");
    assert.equal(declarationRow(declaration({ houseNameOrNumber: '1/2' }))[4], "'1/2");
    assert.equal(declarationRow(declaration({ houseNameOrNumber: 'Rose Cottage' }))[4], "'Rose Cottage");
  });

  test('a donor-typed formula is written as text, never evaluated', () => {
    const row = declarationRow(declaration({ firstName: '=IMPORTXML("http://x","//a")', lastName: '+SUM(1)' }));
    assert.equal(row[2], '\'=IMPORTXML("http://x","//a")');
    assert.equal(row[3], "'+SUM(1)");
    for (const cell of row) assert.doesNotMatch(cell, /^[=+@-]/, `cell ${cell} could be evaluated`);
  });

  test('dates are ISO, empty dates are empty', () => {
    const d = { ...declaration(), confirmationSentOn: '2026-10-25', cancelledOn: null };
    const row = declarationRow(d);
    assert.equal(row[11], '2026-10-18');
    assert.equal(row[13], '2026-10-25');
    assert.equal(row[14], '');
  });

  test('a donation row: amount in pounds, Claim ID always blank, bank ref in notes', () => {
    const d = buildOfflineDonation({
      declarationId: 'GA-7K2QX4', amountPence: 5050, receivedOn: '2026-10-20', method: 'Bank transfer',
      campaign: 'Pool appeal', bankReference: 'SMITH POOL', notes: 'Thank-you card sent', warning: null,
    }, 'treasurer@x', NOW, null);
    const row = donationRow(d);
    assert.equal(row.length, 11);
    assert.deepEqual(row.slice(1), [
      "'GA-7K2QX4", '2026-10-20', '50.50', 'Bank transfer', 'Pool appeal', 'Offline', 'N', 'Received', '',
      "'Bank ref: SMITH POOL. Thank-you card sent",
    ]);
    assert.match(row[0], /^'DN-[0-9A-Z]{6}$/);
  });

  test('an online donation without Gift Aid has a blank declaration ID', () => {
    const d = { ...buildOfflineDonation({
      declarationId: 'GA-7K2QX4', amountPence: 2500, receivedOn: '2026-10-25', method: 'Cheque',
      campaign: 'General', bankReference: null, notes: null, warning: null,
    }, 'website', NOW, null), declarationId: null, method: 'Online' as const, source: 'Web' as const };
    const row = donationRow(d);
    assert.equal(row[1], '');
    assert.equal(row[4], 'Online');
    assert.equal(row[6], 'Web');
    assert.equal(row[10], '');
  });

  test('a small-donation row carries its reference in Notes, because the tab has no ID column', () => {
    const s = buildSmallDonation({ collectedOn: '2026-10-11', eventOrPlace: 'Extravaganza bucket', amountPence: 4250, kind: 'Cash', inBuilding: false, notes: null }, 'michael@x', NOW);
    const row = smallDonationRow(s);
    assert.equal(row.length, 7);
    assert.deepEqual(row.slice(0, 6), ['2026-10-11', "'Extravaganza bucket", '42.50', 'Cash', 'N', "'michael@x"]);
    assert.equal(row[6], `'[${s.id}]`);
    assert.ok(cellMatches('small', `Counted twice [${s.id}]`, s.id));
    assert.equal(cellMatches('small', 'nothing here', s.id), false);
  });

  test('money is integer pence in, never a float', () => {
    assert.equal(asPounds(1), '0.01');
    assert.equal(asPounds(100000), '1000');
    assert.throws(() => asPounds(12.5));
    assert.equal(asText(null), '');
  });

  test('every builder produces exactly the tab\'s width', () => {
    assert.equal(declarationRow(declaration()).length, TABS.declaration.headers.length);
  });
});

/** A fake Sheets API: rows per tab, with the header in row 1. */
function fakeSheets(opts: { failAppend?: boolean; appendThenThrow?: boolean } = {}) {
  const tabs: Record<string, string[][]> = {
    Declarations: [TABS.declaration.headers.slice()],
    Donations: [TABS.donation.headers.slice()],
    'Small donations': [TABS.small.headers.slice()],
  };
  const writes: string[] = [];
  const colIndex = (c: string) => c.charCodeAt(0) - 65;
  const api: SheetsApi = {
    async readColumn(tab, column) { return tabs[tab].map((r) => (r[colIndex(column)] ?? '').replace(/^'/, '')); },
    async append(range, row) {
      if (opts.failAppend) throw new Error('Sheets 503: backend error');
      const tab = range.split('!')[0].replace(/^'|'$/g, '');
      tabs[tab].push(row.slice());
      writes.push(`append ${range}`);
      const n = tabs[tab].length;
      const last = String.fromCharCode(64 + row.length);
      if (opts.appendThenThrow) throw new Error('socket hang up after write');
      return { updatedRange: `${range.split('!')[0]}!A${n}:${last}${n}` };
    },
    async updateCell(a1, value) {
      const m = /^'?(.+?)'?!([A-Z])(\d+)$/.exec(a1)!;
      tabs[m[1]][Number(m[3]) - 1][colIndex(m[2])] = value;
      writes.push(`update ${a1}=${value}`);
    },
  };
  return { api, tabs, writes };
}

describe('syncing to the sheet', () => {
  test('appends once and marks the record', async () => {
    const f = fakeSheets();
    const d = declaration();
    const next = await syncRecord(f.api, { kind: 'declaration', id: d.id, row: declarationRow(d), sync: d.sheet }, NOW);
    assert.equal(next.appended, true);
    assert.equal(next.lastError, null);
    assert.equal(f.tabs.Declarations.length, 2);
    assert.deepEqual(f.writes, ['append Declarations!A:R']);
  });

  test('a failed append leaves the record pending, with the reason, and loses nothing', async () => {
    const f = fakeSheets({ failAppend: true });
    const d = declaration();
    const next = await syncRecord(f.api, { kind: 'declaration', id: d.id, row: declarationRow(d), sync: d.sheet }, NOW);
    assert.equal(next.appended, false);
    assert.equal(next.attempts, 1);
    assert.match(next.lastError!, /503/);
  });

  test('a retry after "appended but crashed before saying so" does not append twice', async () => {
    const f = fakeSheets({ appendThenThrow: true });
    const d = declaration();
    const first = await syncRecord(f.api, { kind: 'declaration', id: d.id, row: declarationRow(d), sync: d.sheet }, NOW);
    assert.equal(first.appended, false, 'the write happened but we could not know it');
    assert.equal(f.tabs.Declarations.length, 2);

    const second = await syncRecord(f.api, { kind: 'declaration', id: d.id, row: declarationRow(d), sync: first }, NOW);
    assert.equal(second.appended, true);
    assert.equal(f.tabs.Declarations.length, 2, 'found by its ID, not appended again');
  });

  test('later changes rewrite only their own cell, leaving the bookkeeper\'s cells alone', async () => {
    const f = fakeSheets();
    const d = declaration();
    const synced = await syncRecord(f.api, { kind: 'declaration', id: d.id, row: declarationRow(d), sync: d.sheet }, NOW);
    // The bookkeeper writes a note in the row.
    f.tabs.Declarations[1][17] = 'Checked by bookkeeper';
    const next = await syncRecord(f.api, {
      kind: 'declaration', id: d.id, row: declarationRow(d),
      sync: { ...synced, pendingUpdates: [{ column: 'O', value: '2026-10-25' }] },
    }, NOW);
    assert.deepEqual(next.pendingUpdates, []);
    assert.equal(f.tabs.Declarations[1][14], '2026-10-25');
    assert.equal(f.tabs.Declarations[1][17], 'Checked by bookkeeper');
    assert.deepEqual(f.writes.at(-1), 'update Declarations!O2=2026-10-25');
  });

  test('a refund updates Donations column I and never touches Claim ID', async () => {
    const f = fakeSheets();
    const d = buildOfflineDonation({
      declarationId: 'GA-7K2QX4', amountPence: 2500, receivedOn: '2026-10-20', method: 'Cheque',
      campaign: 'General', bankReference: null, notes: null, warning: null,
    }, 'x', NOW, null);
    const s1 = await syncRecord(f.api, { kind: 'donation', id: d.id, row: donationRow(d), sync: d.sheet }, NOW);
    f.tabs.Donations[1][9] = 'C-2026-01'; // claimed
    await syncRecord(f.api, { kind: 'donation', id: d.id, row: donationRow(d), sync: { ...s1, pendingUpdates: [{ column: 'I', value: 'Refunded' }] } }, NOW);
    assert.equal(f.tabs.Donations[1][8], 'Refunded');
    assert.equal(f.tabs.Donations[1][9], 'C-2026-01');
  });

  test('a write to a formula column is refused even if queued', async () => {
    const f = fakeSheets();
    const d = declaration();
    const s1 = await syncRecord(f.api, { kind: 'declaration', id: d.id, row: declarationRow(d), sync: d.sheet }, NOW);
    await syncRecord(f.api, { kind: 'declaration', id: d.id, row: declarationRow(d), sync: { ...s1, pendingUpdates: [{ column: 'S', value: 'Valid' }] } }, NOW);
    assert.ok(!f.writes.some((w) => w.includes('!S')), 'column S is the Status ARRAYFORMULA');
  });

  test('a row of the wrong width is never written', async () => {
    const f = fakeSheets();
    const d = declaration();
    const next = await syncRecord(f.api, { kind: 'declaration', id: d.id, row: [...declarationRow(d), 'extra'], sync: freshSync() }, NOW);
    assert.equal(next.appended, false);
    assert.match(next.lastError!, /19 cells/);
    assert.deepEqual(f.writes, []);
  });

  test('the written range must be one row from A to the last input column', () => {
    assert.equal(checkUpdatedRange('declaration', 'Declarations!A7:R7'), null);
    assert.equal(checkUpdatedRange('small', "'Small donations'!A3:G3"), null);
    assert.ok(checkUpdatedRange('declaration', 'Declarations!A7:S7'));
    assert.ok(checkUpdatedRange('declaration', 'Declarations!C7:T7'));
    assert.ok(checkUpdatedRange('donation', 'Donations!A7:K8'));
  });
});

describe('the retry sweep', () => {
  let prev: string | undefined;
  before(() => { prev = process.env.GIFT_AID_SHEET_ID; process.env.GIFT_AID_SHEET_ID = 'test-sheet'; });
  after(() => { if (prev === undefined) delete process.env.GIFT_AID_SHEET_ID; else process.env.GIFT_AID_SHEET_ID = prev; });

  test('sends what failed earlier, then has nothing left to do', async () => {
    const mem = memoryStore();
    const d = declaration();
    await mem.store.createDeclaration(d);
    const down = fakeSheets({ failAppend: true });
    assert.deepEqual(await syncPending(mem.store, down.api), { synced: 0, failed: 1, disabled: false });
    assert.equal(mem.declarations.get(d.id)!.sheet.attempts, 1, 'the failure is recorded on the record');

    const up = fakeSheets();
    assert.deepEqual(await syncPending(mem.store, up.api), { synced: 1, failed: 0, disabled: false });
    assert.deepEqual(await syncPending(mem.store, up.api), { synced: 0, failed: 0, disabled: false });
    assert.equal(up.tabs.Declarations.length, 2);
  });

  test('with no sheet configured, nothing is written anywhere', async () => {
    delete process.env.GIFT_AID_SHEET_ID;
    const mem = memoryStore();
    await mem.store.createDeclaration(declaration());
    const f = fakeSheets();
    assert.deepEqual(await syncPending(mem.store, f.api), { synced: 0, failed: 0, disabled: true });
    assert.deepEqual(f.writes, []);
    process.env.GIFT_AID_SHEET_ID = 'test-sheet';
  });
});
