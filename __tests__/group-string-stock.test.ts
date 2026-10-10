import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as stockGET, POST as stockPOST } from '@/app/api/stringing/stock/route';
import { GET as stringsGET, PATCH as stringsPATCH } from '@/app/api/stringing/strings/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetMockStore, getStore, seedDoc, seedMember, makeRequest, makeAdminRequest, setupAdminPin, seedTestAdminMember, memberCookieValue } from './helpers';

/**
 * The two-club gate for the string inventory and the offered list
 * (docs/plans/string-inventory.md): another club's purchases, jobs and list
 * never reach BPM's summary, and a BPM write is stamped bpm.
 */

const BASE = 'http://localhost:3000/api';

beforeEach(async () => {
  resetMockStore();
  __resetCatalogSeedForTests();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  await seedTestAdminMember();
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
});

describe('string stock group isolation', () => {
  it("another club's purchases, jobs and offered list are invisible to BPM", async () => {
    const lin = seedMember('Lin');
    seedDoc('stringStock', { id: 'sp-0000000000000aaa', groupId: 'other', kind: 'purchase', label: 'BG65', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 9000, date: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', createdBy: 'x' });
    seedDoc('stringingJobs', { id: 'job-other', groupId: 'other', memberId: lin.id, stringLabel: 'BG65', status: 'picked_up' });
    seedDoc('clubSettings', { id: 'other:stringing-strings', groupId: 'other', strings: ['Elsewhere string'], links: {}, updatedAt: '', updatedBy: null });

    await stringsPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/strings`, { strings: ['BG65'] }));
    const posted = await stockPOST(makeAdminRequest('POST', `${BASE}/stringing/stock`, { label: 'BG65', unit: 'set', units: 2, metresPerUnit: 10, totalCostCents: 2000, date: '2026-10-02' }));
    expect((await posted.json()).purchase.groupId).toBe('bpm');

    const summary = await (await stockGET(makeAdminRequest('GET', `${BASE}/stringing/stock`))).json();
    expect(summary.purchases.map((p: { id: string }) => p.id)).not.toContain('sp-0000000000000aaa');
    expect(summary.lines).toEqual([expect.objectContaining({ label: 'BG65', purchasedMetres: 20, usedSets: 0 })]);

    const read = await (await stringsGET(makeRequest('GET', `${BASE}/stringing/strings`, undefined, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }))).json();
    expect(read.strings).toEqual(['BG65']);
    expect((getStore()['stringStock'] as Array<{ groupId?: string }>).map((d) => d.groupId).sort()).toEqual(['bpm', 'other']);
  });
});
