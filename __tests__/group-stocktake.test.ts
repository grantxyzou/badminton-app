import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as stockGET, POST as stockPOST } from '@/app/api/stringing/stock/route';
import { PATCH as stringsPATCH } from '@/app/api/stringing/strings/route';
import { GET as countGET, POST as countPOST } from '@/app/api/stringing/stocktake/route';
import { POST as barcodePOST } from '@/app/api/stringing/stocktake/barcode/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetShelfCache } from '@/lib/stringShelfRead';
import { resetMockStore, getStore, seedDoc, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * The two-club gate for the stocktake (docs/plans/string-photo-stocktake.md,
 * docs/plans/string-barcode-stocktake.md): another club's count never resets
 * BPM's shelf, another club's barcode never reaches BPM's scanner, and BPM's
 * own are stamped bpm.
 */

const BASE = 'http://localhost:3000/api';

beforeEach(async () => {
  resetMockStore();
  __resetCatalogSeedForTests();
  resetShelfCache();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  await seedTestAdminMember();
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
});

describe('stocktake group isolation', () => {
  it("another club's count does not touch BPM's shelf, and BPM's count is stamped bpm", async () => {
    await stringsPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/strings`, { strings: ['BG80'] }));
    await stockPOST(makeAdminRequest('POST', `${BASE}/stringing/stock`, { label: 'BG80', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 20000, date: '2026-11-01' }));
    seedDoc('clubSettings', {
      id: 'sc-0000000000000aaa', groupId: 'other', kind: 'stringCount', countedAt: '2099-01-01T00:00:00Z', countedBy: 'x', source: 'hand',
      lines: [{ label: 'BG80', sets: 1, appSets: 0 }],
    });

    const before = await (await countGET(makeAdminRequest('GET', `${BASE}/stringing/stocktake`))).json();
    expect(before.strings[0]).toMatchObject({ label: 'BG80', appSets: 20, lastCount: null });

    const saved = await countPOST(makeAdminRequest('POST', `${BASE}/stringing/stocktake`, { source: 'hand', lines: [{ label: 'BG80', packets: 7 }] }));
    expect(saved.status).toBe(201);
    const stock = await (await stockGET(makeAdminRequest('GET', `${BASE}/stringing/stock`))).json();
    expect(stock.lines[0]).toMatchObject({ label: 'BG80', remainingSets: 7 });
    const groups = (getStore()['clubSettings'] as Array<{ kind?: string; groupId?: string }>).filter((r) => r.kind === 'stringCount').map((r) => r.groupId).sort();
    expect(groups).toEqual(['bpm', 'other']);
  });

  it("another club's barcode is not BPM's, and BPM's own is stamped bpm", async () => {
    await stringsPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/strings`, { strings: ['BG80'] }));
    // The other club taught the same code as BG80 (BPM offers BG80 too).
    seedDoc('clubSettings', {
      id: 'other:stringBarcode:34393035353338393030303030', groupId: 'other', kind: 'stringBarcode',
      code: '4905538900000', label: 'BG80', form: 'packet', taughtBy: 'x', taughtAt: '2026-11-01T00:00:00Z',
    });
    const before = await (await countGET(makeAdminRequest('GET', `${BASE}/stringing/stocktake`))).json();
    expect(before.barcodes).toEqual([]);

    const taught = await barcodePOST(makeAdminRequest('POST', `${BASE}/stringing/stocktake/barcode`, { code: '4905538911111', label: 'bg80', form: 'reel' }));
    expect(taught.status).toBe(201);
    const after = await (await countGET(makeAdminRequest('GET', `${BASE}/stringing/stocktake`))).json();
    expect(after.barcodes).toEqual([{ code: '4905538911111', label: 'BG80', form: 'reel', color: null }]);
    const groups = (getStore()['clubSettings'] as Array<{ kind?: string; groupId?: string }>).filter((r) => r.kind === 'stringBarcode').map((r) => r.groupId).sort();
    expect(groups).toEqual(['bpm', 'other']);
  });
});
