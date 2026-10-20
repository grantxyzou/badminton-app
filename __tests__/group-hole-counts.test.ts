import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET, PUT, DELETE } from '@/app/api/stringing/holes/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetMockStore, getStore, seedDoc, seedMember, makeRequest, makeAdminRequest, setupAdminPin, seedTestAdminMember, memberCookieValue } from './helpers';

/**
 * A stringer's grommet counts (docs/plans/grommet-holes.md, Phase 3): per
 * club, admin-written, member-read, and only where no maker or pattern
 * source already answers.
 */

const URL_ = 'http://localhost:3000/api/stringing/holes';
// Li-Ning publishes no hole counts, so every Li-Ning row is countable.
const AXFORCE_80 = 'racket-li-ning-axforce-80';
// Yonex family 1: 76 from the pattern sheet. Not countable.
const ASTROX_100ZZ = 'racket-yonex-astrox-100zz';

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

const memberGet = (id: string) => GET(makeRequest('GET', URL_, undefined, { Cookie: `member_session=${memberCookieValue('Lin', id)}` }));

describe('hole counts', () => {
  it("another club's count never reaches BPM, and BPM's write is stamped bpm", async () => {
    const lin = seedMember('Lin');
    seedDoc('clubSettings', { id: `other:holes:${AXFORCE_80}`, groupId: 'other', kind: 'holeCount', catalogId: AXFORCE_80, holes: 72, countedAt: '2026-10-20T00:00:00Z', countedBy: 'x' });

    expect((await (await memberGet(lin.id)).json()).counts).toEqual({});

    const put = await PUT(makeAdminRequest('PUT', URL_, { catalogId: AXFORCE_80, holes: 76 }));
    expect(put.status).toBe(200);
    expect((await (await memberGet(lin.id)).json()).counts).toEqual({ [AXFORCE_80]: 76 });

    const rows = (getStore()['clubSettings'] as Array<{ kind?: string; groupId?: string; id: string }>).filter((d) => d.kind === 'holeCount');
    expect(rows.map((r) => [r.id, r.groupId]).sort()).toEqual([[`holes:${AXFORCE_80}`, 'bpm'], [`other:holes:${AXFORCE_80}`, 'other']]);
  });

  it('a second count for the same racket corrects the first', async () => {
    const lin = seedMember('Lin');
    await PUT(makeAdminRequest('PUT', URL_, { catalogId: AXFORCE_80, holes: 72 }));
    await PUT(makeAdminRequest('PUT', URL_, { catalogId: AXFORCE_80, holes: 76 }));
    expect((await (await memberGet(lin.id)).json()).counts).toEqual({ [AXFORCE_80]: 76 });
  });

  it('refuses a racket the maker or its pattern already answers for', async () => {
    const res = await PUT(makeAdminRequest('PUT', URL_, { catalogId: ASTROX_100ZZ, holes: 72 }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('already_known');
  });

  it('refuses an unknown racket and an impossible count', async () => {
    expect((await PUT(makeAdminRequest('PUT', URL_, { catalogId: 'racket-nope', holes: 76 }))).status).toBe(400);
    for (const holes of [0, 59, 101, 76.5, '76']) {
      const res = await PUT(makeAdminRequest('PUT', URL_, { catalogId: AXFORCE_80, holes }));
      expect(res.status, String(holes)).toBe(400);
    }
  });

  it('only an admin writes or clears; a member cookie is refused', async () => {
    const lin = seedMember('Lin');
    const cookie = { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` };
    expect((await PUT(makeRequest('PUT', URL_, { catalogId: AXFORCE_80, holes: 76 }, cookie))).status).toBe(401);
    expect((await DELETE(makeRequest('DELETE', `${URL_}?catalogId=${AXFORCE_80}`, undefined, cookie))).status).toBe(401);
  });

  it('clears a count, and only a hole-count row', async () => {
    const lin = seedMember('Lin');
    await PUT(makeAdminRequest('PUT', URL_, { catalogId: AXFORCE_80, holes: 76 }));
    expect((await DELETE(makeAdminRequest('DELETE', `${URL_}?catalogId=${AXFORCE_80}`))).status).toBe(200);
    expect((await (await memberGet(lin.id)).json()).counts).toEqual({});
    // Nothing left to clear: 404, not a silent success.
    expect((await DELETE(makeAdminRequest('DELETE', `${URL_}?catalogId=${AXFORCE_80}`))).status).toBe(404);
  });

  it('a stored count gives way when the racket gains a sourced one', async () => {
    const lin = seedMember('Lin');
    // As if counted before a catalog update mapped this racket to a pattern.
    seedDoc('clubSettings', { id: `holes:${ASTROX_100ZZ}`, groupId: 'bpm', kind: 'holeCount', catalogId: ASTROX_100ZZ, holes: 72, countedAt: '2026-10-20T00:00:00Z', countedBy: 'x' });
    expect((await (await memberGet(lin.id)).json()).counts).toEqual({});
  });

  it('404s with the stringing flag off', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
    expect((await GET(makeAdminRequest('GET', URL_))).status).toBe(404);
  });
});
