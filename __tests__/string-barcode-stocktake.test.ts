import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PATCH as stringsPATCH } from '@/app/api/stringing/strings/route';
import { GET as countGET, POST as countPOST } from '@/app/api/stringing/stocktake/route';
import { POST as barcodePOST } from '@/app/api/stringing/stocktake/barcode/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetShelfCache } from '@/lib/stringShelfRead';
import { barcodeAnswers, barcodeDocId, isBarcode, validateBarcode, BarcodeError, type StringBarcode } from '@/lib/stringBarcodes';
import {
  addPacket, addReel, linesForSave, makeScanGate, rowsOf, updateRow, weighIncomplete, withoutString, type Tally,
} from '@/lib/stocktakeTally';
import { resetMockStore, getStore, seedMember, makeRequest, makeAdminRequest, memberCookieValue, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * The barcode stocktake (docs/plans/string-barcode-stocktake.md; Grant,
 * 2026-11-16: "why cant we just treat reading inventory like scanning a
 * product in? … scan, log amount, colour, then recon").
 */

describe('the tally', () => {
  it('a packet adds one to its string and colour; a reel adds a reel', () => {
    let t: Tally = {};
    t = addPacket(t, { label: 'BG80', color: 'white' });
    t = addPacket(t, { label: 'BG80', color: 'white' });
    t = addPacket(t, { label: 'BG80', color: null });
    t = addReel(t, { label: 'BG80', color: 'white' }, { by: 'eye', fullness: 'half' });
    expect(rowsOf(t, 'BG80')).toEqual([
      { label: 'BG80', color: null, packets: 1, reels: [] },
      { label: 'BG80', color: 'white', packets: 2, reels: [{ by: 'eye', fullness: 'half' }] },
    ]);
  });

  it('saves one line per row, colour only when there is one, weigh-ins as numbers', () => {
    let t: Tally = addPacket({}, { label: 'BG80', color: 'white' });
    t = addReel(t, { label: 'Exbolt 63', color: null }, { by: 'weigh', grams: '121', tare: '70', gpm: '0.41' });
    expect(linesForSave(t)).toEqual([
      { label: 'BG80', color: 'white', packets: 1, reels: [] },
      { label: 'Exbolt 63', packets: 0, reels: [{ by: 'weigh', grams: 121, tareGrams: 70, gramsPerMetre: 0.41 }] },
    ]);
  });

  it('a weigh-in missing a figure holds Save; "leave it out" drops every colour of a string', () => {
    let t: Tally = addReel({}, { label: 'BG80', color: null }, { by: 'weigh', grams: '', tare: '70', gpm: '0.41' });
    expect(weighIncomplete(t)).toBe(true);
    t = updateRow(t, 'BG80', null, (r) => ({ ...r, reels: [{ by: 'weigh', grams: '120', tare: '70', gpm: '0.41' }] }));
    expect(weighIncomplete(t)).toBe(false);
    t = addPacket(t, { label: 'BG80', color: 'white' });
    t = addPacket(t, { label: 'BG66', color: null });
    expect(Object.values(withoutString(t, 'BG80')).map((r) => r.label)).toEqual(['BG66']);
  });

  it('a code held in view counts once; shown again after a gap, or after another code, it counts again', () => {
    const accept = makeScanGate(1500);
    expect(accept('A', 0)).toBe(true);
    // The camera reads it ten times a second while it stays in view.
    expect(accept('A', 100)).toBe(false);
    expect(accept('A', 1400)).toBe(false);
    // Taken away and shown again.
    expect(accept('A', 3000)).toBe(true);
    // A different packet in between: the next A is a new packet.
    expect(accept('B', 3100)).toBe(true);
    expect(accept('A', 3200)).toBe(true);
  });
});

describe('a barcode', () => {
  it('is a printable code a label can carry; anything else is refused', () => {
    expect(isBarcode('4905538900000')).toBe(true);
    expect(isBarcode('ABC-123/45')).toBe(true);
    expect(isBarcode('123')).toBe(false);
    expect(isBarcode('has space')).toBe(false);
    expect(isBarcode('x'.repeat(65))).toBe(false);
    expect(isBarcode(4905538900000)).toBe(false);
  });

  it('is taught as an offered string (any case), a palette colour or none, packet or reel', () => {
    expect(validateBarcode({ code: '4905538900000', label: 'bg80', form: 'packet' }, ['BG80'])).toEqual({ code: '4905538900000', label: 'BG80', form: 'packet' });
    expect(validateBarcode({ code: '4905538900000', label: 'BG80', form: 'reel', color: 'white' }, ['BG80'])).toMatchObject({ color: 'white' });
    expect(() => validateBarcode({ code: '4905538900000', label: 'Nope', form: 'packet' }, ['BG80'])).toThrow(BarcodeError);
    expect(() => validateBarcode({ code: '4905538900000', label: 'BG80', form: 'box' }, ['BG80'])).toThrow(BarcodeError);
    expect(() => validateBarcode({ code: '4905538900000', label: 'BG80', form: 'packet', color: 'not-a-colour' }, ['BG80'])).toThrow(BarcodeError);
  });

  it("its id hides the code's own characters, and a new club's carries its prefix", () => {
    expect(barcodeDocId('bpm', 'AB/1')).toBe('stringBarcode:41422f31');
    expect(barcodeDocId('six', 'AB/1')).toBe('six:stringBarcode:41422f31');
  });

  it('a string that left the shelf drops its barcodes from the sheet', () => {
    const row = (code: string, label: string): StringBarcode => ({ id: code, kind: 'stringBarcode', code, label, form: 'packet', taughtBy: 'a', taughtAt: '' });
    expect(barcodeAnswers([row('1111', 'bg80'), row('2222', 'Gone')], ['BG80'])).toEqual([{ code: '1111', label: 'BG80', form: 'packet', color: null }]);
  });
});

// ── Through the routes ──────────────────────────────────────────────────────

const BASE = 'http://localhost:3000/api';

describe('teaching a barcode', () => {
  beforeEach(async () => {
    resetMockStore();
    __resetCatalogSeedForTests();
    resetShelfCache();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    await seedTestAdminMember();
    await stringsPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/strings`, { strings: ['BG80', 'Exbolt 63'] }));
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
  });

  const asMember = (name: string, id: string) => ({ Cookie: `member_session=${memberCookieValue(name, id)}` });
  const teach = (body: Record<string, unknown>, headers?: Record<string, string>) =>
    headers
      ? barcodePOST(makeRequest('POST', `${BASE}/stringing/stocktake/barcode`, body, headers))
      : barcodePOST(makeAdminRequest('POST', `${BASE}/stringing/stocktake/barcode`, body));
  const barcodeRows = () => (getStore()['clubSettings'] as Array<{ kind?: string }>).filter((r) => r.kind === 'stringBarcode');

  it('an admin and a stringer may teach; a player and a stranger may not', async () => {
    const zach = seedMember('Zach', { canString: true });
    const lin = seedMember('Lin');
    expect((await teach({ code: '4905538900000', label: 'BG80', form: 'packet', color: 'white' })).status).toBe(201);
    expect((await teach({ code: '4905538900017', label: 'Exbolt 63', form: 'reel' }, asMember('Zach', zach.id))).status).toBe(201);
    expect((await teach({ code: '4905538900024', label: 'BG80', form: 'packet' }, asMember('Lin', lin.id))).status).toBe(401);
    expect((await teach({ code: '4905538900024', label: 'BG80', form: 'packet' }, {})).status).toBe(401);
    expect(barcodeRows()).toHaveLength(2);
    expect(barcodeRows()[1]).toMatchObject({ code: '4905538900017', label: 'Exbolt 63', form: 'reel', taughtBy: zach.id, groupId: 'bpm' });

    // The sheet carries them, and no money.
    const sheet = await (await countGET(makeAdminRequest('GET', `${BASE}/stringing/stocktake`))).json();
    expect(sheet.barcodes).toEqual([
      { code: '4905538900000', label: 'BG80', form: 'packet', color: 'white' },
      { code: '4905538900017', label: 'Exbolt 63', form: 'reel', color: null },
    ]);
    expect(JSON.stringify(sheet)).not.toMatch(/Cents|price|cost/i);
  });

  it('taught again, a code replaces its answer: one row, the new string and form', async () => {
    expect((await teach({ code: '4905538900000', label: 'BG80', form: 'packet', color: 'white' })).status).toBe(201);
    const again = await teach({ code: '4905538900000', label: 'Exbolt 63', form: 'reel' });
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ code: '4905538900000', label: 'Exbolt 63', form: 'reel', color: null });
    expect(barcodeRows()).toHaveLength(1);
    expect(barcodeRows()[0]).not.toHaveProperty('color');
  });

  it('refuses a string not on the shelf, a bad code and a bad form', async () => {
    expect((await teach({ code: '4905538900000', label: 'Nope', form: 'packet' })).status).toBe(400);
    expect((await teach({ code: '12', label: 'BG80', form: 'packet' })).status).toBe(400);
    expect((await teach({ code: '4905538900000', label: 'BG80', form: 'tube' })).status).toBe(400);
    expect(barcodeRows()).toHaveLength(0);
  });

  it('a scanned count saves per colour, and the same colour twice is refused', async () => {
    const res = await countPOST(makeAdminRequest('POST', `${BASE}/stringing/stocktake`, {
      source: 'scan',
      lines: [{ label: 'BG80', color: 'white', packets: 3 }, { label: 'BG80', packets: 2 }],
    }));
    expect(res.status).toBe(201);
    expect((await res.json()).lines).toEqual([{ label: 'BG80', appSets: 0, counted: 5 }]);
    const saved = (getStore()['clubSettings'] as Array<{ kind?: string; source?: string; lines?: unknown[] }>).find((r) => r.kind === 'stringCount');
    expect(saved).toMatchObject({ source: 'scan', lines: [{ label: 'BG80', color: 'white', sets: 3 }, { label: 'BG80', sets: 2 }] });

    const twice = await countPOST(makeAdminRequest('POST', `${BASE}/stringing/stocktake`, {
      source: 'scan', lines: [{ label: 'BG80', color: 'white', packets: 1 }, { label: 'bg80', color: 'white', packets: 1 }],
    }));
    expect(twice.status).toBe(400);
  });
});
