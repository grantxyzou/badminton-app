import { describe, it, expect, beforeEach } from 'vitest';
import { PATCH, GET, POST, PUT, DELETE } from '../app/api/equipment/gear/route';
import { resetMockStore, seedMember, setupAdminPin, makeRequest, memberCookieValue } from './helpers';
import { parseCrosses } from '../lib/stringCrosses';
import { tallyClubTension } from '../lib/clubTension';

const BASE = 'http://localhost:3000/api/equipment/gear';

/**
 * A hybrid stringing: the crosses string nested on the mains string item
 * (Grant, 2026-09-15). Written only by PATCH `itemCrosses`, so it must survive
 * PUT (which rebuilds an item from the wire, and is how a tension is saved)
 * and leave with the mains string.
 */
describe('hybrid crosses', () => {
  const cookie = { Cookie: `member_session=${memberCookieValue('Lin')}` };

  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    seedMember('Lin', { id: 'member-lin' });
  });

  async function read() {
    return (await (await GET(makeRequest('GET', `${BASE}?name=Lin`, undefined, cookie))).json()).gear;
  }
  const patch = (itemCrosses: unknown) => PATCH(makeRequest('PATCH', BASE, { name: 'Lin', itemCrosses }, cookie));

  async function addMains() {
    await POST(makeRequest('POST', BASE, { name: 'Lin', makeActive: true, item: { catalogId: 'racket-yonex-astrox-88d-pro', category: 'racket', label: 'Yonex Astrox 88D Pro' } }, cookie));
    const res = await POST(makeRequest('POST', BASE, { name: 'Lin', item: { catalogId: 'string-yonex-bg80', category: 'string', label: 'Yonex BG80' } }, cookie));
    expect(res.status).toBe(200);
    return (await read()).items.find((i: { category: string }) => i.category === 'string').id as string;
  }

  it('sets, re-tensions and removes the crosses on the mains string', async () => {
    const id = await addMains();
    expect((await patch({ itemId: id, crosses: { catalogId: 'string-yonex-bg66', label: 'Yonex BG66 Ultimax' } })).status).toBe(200);
    expect((await read()).items.find((i: { id: string }) => i.id === id).crosses).toEqual({ catalogId: 'string-yonex-bg66', label: 'Yonex BG66 Ultimax' });

    await patch({ itemId: id, crosses: { catalogId: 'string-yonex-bg66', label: 'Yonex BG66 Ultimax', tensionLbs: 28 } });
    expect((await read()).items.find((i: { id: string }) => i.id === id).crosses.tensionLbs).toBe(28);

    expect((await patch({ itemId: id, crosses: null })).status).toBe(200);
    expect((await read()).items.find((i: { id: string }) => i.id === id).crosses).toBeUndefined();
  });

  it('is a string thing: a racket id is not found, and a bad tension is refused', async () => {
    const id = await addMains();
    const racketId = (await read()).items.find((i: { category: string }) => i.category === 'racket').id;
    expect((await patch({ itemId: racketId, crosses: { label: 'Yonex BG66' } })).status).toBe(404);
    expect((await patch({ itemId: id, crosses: { label: 'Yonex BG66', tensionLbs: 55 } })).status).toBe(400);
    expect((await patch({ itemId: id, crosses: { label: '' } })).status).toBe(400);
    expect((await patch({ itemId: id })).status).toBe(400);
    expect((await read()).items.find((i: { id: string }) => i.id === id).crosses).toBeUndefined();
  });

  it('survives saving the mains tension (PUT rebuilds the item from the wire)', async () => {
    const id = await addMains();
    await patch({ itemId: id, crosses: { catalogId: null, label: 'Yonex BG66', tensionLbs: 28 } });
    const put = await PUT(makeRequest('PUT', BASE, { name: 'Lin', item: { catalogId: 'string-yonex-bg80', category: 'string', label: 'Yonex BG80', tensionLbs: 26 } }, cookie));
    expect(put.status).toBe(200);
    const item = (await read()).items.find((i: { id: string }) => i.id === id);
    expect(item.tensionLbs).toBe(26);
    expect(item.crosses).toEqual({ catalogId: null, label: 'Yonex BG66', tensionLbs: 28 });
  });

  it('leaves with the mains string', async () => {
    const id = await addMains();
    await patch({ itemId: id, crosses: { label: 'Yonex BG66' } });
    const del = await DELETE(makeRequest('DELETE', `${BASE}?name=Lin&itemId=${id}`, undefined, cookie));
    expect(del.status).toBe(200);
    expect((await read()).items.some((i: { crosses?: unknown }) => i.crosses)).toBe(false);
  });
});

describe('parseCrosses', () => {
  it('takes a label, an optional catalog id and a whole-pound tension the field could hold', () => {
    expect(parseCrosses({ label: ' BG66 ', catalogId: 'x', tensionLbs: 28 })).toEqual({ catalogId: 'x', label: 'BG66', tensionLbs: 28 });
    expect(parseCrosses({ label: 'BG66' })).toEqual({ catalogId: null, label: 'BG66' });
    expect(parseCrosses({ label: 'BG66', tensionLbs: 27.5 })).toBeNull();
    expect(parseCrosses({ label: 'BG66', tensionLbs: 9 })).toBeNull();
    expect(parseCrosses({ label: 'BG66', catalogId: 5 })).toBeNull();
    expect(parseCrosses({ catalogId: 'x' })).toBeNull();
    expect(parseCrosses(null)).toBeNull();
  });
});

describe('a hybrid reads as its mains everywhere else', () => {
  it('the club band takes the mains tension, never the crosses', () => {
    const doc = (memberId: string, mains: number) => ({
      memberId,
      activeRacketId: 'r',
      items: [
        { id: 'r', catalogId: 'frame', category: 'racket' as const, label: 'Frame' },
        { id: 's', catalogId: null, category: 'string' as const, label: 'BG80', tensionLbs: mains, crosses: { catalogId: null, label: 'BG66', tensionLbs: 40 } },
      ],
    });
    const band = tallyClubTension([doc('a', 24), doc('b', 25), doc('c', 26)]).get('frame');
    expect(band?.high).toBe(26);
  });
});
