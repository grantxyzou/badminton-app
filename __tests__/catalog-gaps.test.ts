import { describe, it, expect, beforeEach } from 'vitest';
import { catalogGaps, nearestCatalogRow } from '../lib/catalogGaps';
import { GET } from '../app/api/admin/catalog-gaps/route';
import { GET as FIT_PREVIEW } from '../app/api/admin/fit-preview/route';
import { resetMockStore, getStore, seedMember, setupAdminPin, makeRequest, makeAdminRequest, memberCookieValue } from './helpers';
import { __resetCatalogSeedForTests } from '../lib/catalogSeed';
import type { CatalogItem, GearItem } from '../lib/types';

const CATALOG = [
  { id: 'racket-yonex-nanoflare-800', category: 'racket', brand: 'Yonex', model: 'Nanoflare 800' },
  { id: 'racket-li-ning-air-force-79', category: 'racket', brand: 'Li-Ning', model: 'Air Force 79' },
] as unknown as CatalogItem[];

const typed = (id: string, label: string, extra: Partial<GearItem> = {}): GearItem =>
  ({ id, catalogId: null, category: 'racket', label, ...extra }) as GearItem;

describe('catalogGaps', () => {
  it('groups typed rackets by name across casing, one vote per member, most common first', () => {
    const docs = [
      { memberId: 'a', items: [typed('1', 'Victor Thruster K 9000', { feel: { balance: 'Head-heavy', flex: 'Stiff' } }), typed('2', 'victor thruster k 9000 ', { feel: { balance: 'Head-heavy' } })] },
      { memberId: 'b', items: [typed('3', 'VICTOR Thruster K 9000', { feel: { balance: 'Head-heavy' } })] },
      { memberId: 'c', items: [typed('4', 'Old Carlton')] },
    ];
    const names = new Map([['a', 'Lin'], ['b', 'Akane'], ['c', 'Viktor']]);
    const gaps = catalogGaps(docs, names, CATALOG);
    expect(gaps.map((g) => [g.label, g.count])).toEqual([['Victor Thruster K 9000', 2], ['Old Carlton', 1]]);
    expect(gaps[0].members).toEqual(['Akane', 'Lin']);
    expect(gaps[0].feel.balance).toEqual({ 'Head-heavy': 2 });
    expect(gaps[0].feel.flex).toEqual({ Stiff: 1 });
  });

  it('leaves out catalog rackets, retired rackets, strings, and names off the roster', () => {
    const docs = [
      { memberId: 'a', items: [
        { id: 'c', catalogId: 'racket-yonex-nanoflare-800', category: 'racket', label: 'Yonex Nanoflare 800' } as GearItem,
        typed('r', 'Retired frame', { retiredAt: '2026-01-01' }),
        { id: 's', catalogId: null, category: 'string', label: 'Mystery string' } as GearItem,
        typed('k', 'Kept frame'),
      ] },
      { memberId: 'gone', items: [typed('x', 'Kept frame')] },
    ];
    const gaps = catalogGaps(docs, new Map([['a', 'Lin']]), CATALOG);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ label: 'Kept frame', count: 2, members: ['Lin'] });
  });

  it('suggests the closest catalog model by shared words, and nothing for an unrelated name', () => {
    expect(nearestCatalogRow('nanoflare800', CATALOG)).toEqual({ id: 'racket-yonex-nanoflare-800', label: 'Yonex Nanoflare 800', likely: true });
    expect(nearestCatalogRow('Nanoflare 800 Pro', CATALOG)).toMatchObject({ id: 'racket-yonex-nanoflare-800', likely: false });
    expect(nearestCatalogRow('Old Carlton', CATALOG)).toBeNull();
  });

  it('one racket however it was spaced or punctuated', () => {
    const docs = [
      { memberId: 'a', items: [typed('1', 'Nanoflare800')] },
      { memberId: 'b', items: [typed('2', 'nanoflare-800')] },
    ];
    expect(catalogGaps(docs, new Map([['a', 'Lin'], ['b', 'Akane']]), CATALOG)).toHaveLength(1);
  });
});

describe('GET /api/admin/catalog-gaps', () => {
  beforeEach(() => { resetMockStore(); __resetCatalogSeedForTests(); setupAdminPin(); });

  it('is admin only', async () => {
    seedMember('Lin');
    const res = await GET(makeRequest('GET', 'http://localhost/api/admin/catalog-gaps', undefined, { Cookie: `member_session=${memberCookieValue('Lin')}` }));
    expect(res.status).toBe(401);
  });

  it('lists a typed racket with the member\'s name, and never carries the arm answer', async () => {
    const lin = seedMember('Lin');
    getStore()['playerGear'] = [{ id: `gear-${lin.id}`, memberId: lin.id, items: [typed('1', 'Victor Thruster K 9000')], fitArmComfort: 'often_sore', fitSoreness: 'elbow' }];
    const res = await GET(makeAdminRequest('GET', 'http://localhost/api/admin/catalog-gaps'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).gaps[0]).toMatchObject({ label: 'Victor Thruster K 9000', count: 1, members: ['Lin'] });
    expect(text).not.toMatch(/sore|fitArmComfort|fitSoreness/);
  });
});

describe('GET /api/admin/fit-preview skeletons', () => {
  beforeEach(() => { resetMockStore(); __resetCatalogSeedForTests(); setupAdminPin(); });

  it('never send a member\'s arm answer to an admin', async () => {
    const lin = seedMember('Lin');
    getStore()['playerGear'] = [{ id: `gear-${lin.id}`, memberId: lin.id, items: [], fitGoal: 'happy', fitArmComfort: 'often_sore', fitSoreness: 'elbow' }];
    const res = await FIT_PREVIEW(makeAdminRequest('GET', 'http://localhost/api/admin/fit-preview'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('happy');
    expect(text).not.toMatch(/often_sore|fitArmComfort|fitSoreness/);
  });
});
