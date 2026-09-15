import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PATCH, POST, PUT, GET } from '../app/api/equipment/gear/route';
import { parseItemLook, modelInputs, SWATCHES } from '../lib/racketCustom';
import { DEFAULT_LOOK } from '../lib/racketLook';
import { resetMockStore, setupAdminPin, seedMember, memberCookieValue, makeRequest } from './helpers';

/**
 * What a member may change about how their racket looks (Grant, 2026-09-14):
 * string and wrap on any racket; frame paint and head shape only on a racket
 * typed in by name.
 */

describe('parseItemLook', () => {
  it('takes palette colours and refuses anything else', () => {
    expect(parseItemLook({ string: SWATCHES.string[1], wrap: SWATCHES.wrap[4] }, true)).toEqual({ string: SWATCHES.string[1], wrap: SWATCHES.wrap[4] });
    expect(parseItemLook({ string: '#123456' }, true)).toBeNull();
    expect(parseItemLook({ wrap: 'red' }, true)).toBeNull();
  });

  it('refuses frame paint and head shape on a catalog racket, takes them on a typed one', () => {
    const custom = { frame: SWATCHES.frame[2], pattern: 'chevron', shape: 'oval' };
    expect(parseItemLook(custom, true)).toBeNull();
    expect(parseItemLook(custom, false)).toEqual(custom);
    expect(parseItemLook({ pattern: 'zigzag' }, false)).toBeNull();
  });

  it('the model paints the member\'s choices over the colourway', () => {
    const { look, tweaks } = modelInputs(DEFAULT_LOOK, { string: SWATCHES.string[1] });
    expect(look.frame).toBe(DEFAULT_LOOK.frame);
    expect(tweaks.string).toBe(SWATCHES.string[1]);
    expect(tweaks.wrap).toBeNull();
    expect(tweaks.shape).toBe('isometric');
  });
});

describe('PATCH itemLook', () => {
  const cookie = { Cookie: `member_session=${memberCookieValue('Lin', 'member-lin')}` };
  const URL_ = 'http://localhost/api/equipment/gear';
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    seedMember('Lin', { id: 'member-lin' });
  });
  async function items() {
    return (await (await GET(makeRequest('GET', `${URL_}?name=Lin`, undefined, cookie))).json()).gear.items;
  }

  it('stores string and wrap on a catalog racket, keeps them through a PUT, and refuses frame paint', async () => {
    await POST(makeRequest('POST', URL_, { name: 'Lin', item: { catalogId: 'racket-yonex-astrox-100zz', category: 'racket', label: 'Yonex Astrox 100ZZ' } }, cookie));
    const id = (await items())[0].id;
    const ok = await PATCH(makeRequest('PATCH', URL_, { name: 'Lin', itemLook: { itemId: id, string: SWATCHES.string[1], wrap: SWATCHES.wrap[4] } }, cookie));
    expect(ok.status).toBe(200);
    await PUT(makeRequest('PUT', URL_, { name: 'Lin', item: { catalogId: 'racket-yonex-astrox-100zz', category: 'racket', label: 'Yonex Astrox 100ZZ' } }, cookie));
    expect((await items())[0].look).toEqual({ string: SWATCHES.string[1], wrap: SWATCHES.wrap[4] });
    const refused = await PATCH(makeRequest('PATCH', URL_, { name: 'Lin', itemLook: { itemId: id, frame: SWATCHES.frame[0] } }, cookie));
    expect(refused.status).toBe(400);
  });

  it('a typed racket takes paint; picking its catalog row later keeps only string and wrap', async () => {
    await POST(makeRequest('POST', URL_, { name: 'Lin', item: { catalogId: null, category: 'racket', label: 'Yonex Astrox 100ZZ' } }, cookie));
    const id = (await items())[0].id;
    const res = await PATCH(makeRequest('PATCH', URL_, { name: 'Lin', itemLook: { itemId: id, frame: SWATCHES.frame[3], shape: 'boxy', wrap: SWATCHES.wrap[2] } }, cookie));
    expect(res.status).toBe(200);
    await POST(makeRequest('POST', URL_, { name: 'Lin', item: { catalogId: 'racket-yonex-astrox-100zz', category: 'racket', label: 'Yonex Astrox 100ZZ' } }, cookie));
    expect((await items())[0].look).toEqual({ wrap: SWATCHES.wrap[2] });
  });

  it('an empty look puts the racket back as it comes', async () => {
    await POST(makeRequest('POST', URL_, { name: 'Lin', item: { catalogId: 'racket-yonex-astrox-100zz', category: 'racket', label: 'Yonex Astrox 100ZZ' } }, cookie));
    const id = (await items())[0].id;
    await PATCH(makeRequest('PATCH', URL_, { name: 'Lin', itemLook: { itemId: id, string: SWATCHES.string[1] } }, cookie));
    await PATCH(makeRequest('PATCH', URL_, { name: 'Lin', itemLook: { itemId: id } }, cookie));
    expect((await items())[0].look).toBeUndefined();
  });
});

describe('three.js stays out of the main bundle', () => {
  // The model is only ever reached through a dynamic import(); a static one
  // anywhere in app code would put ~600 KB of three.js on every page.
  const ALLOWED = new Set(['lib/racketModel.ts', 'lib/racketStage.ts']);
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((e) => {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) return e === 'node_modules' ? [] : walk(full);
      return /\.(ts|tsx)$/.test(e) ? [full] : [];
    });
  }
  it('no app file statically imports three or the model', () => {
    const offenders = ['app', 'components', 'lib'].flatMap((d) => walk(d)).filter((f) => {
      if (ALLOWED.has(f)) return false;
      const src = readFileSync(f, 'utf8');
      return /^import\s+(?!type\b)[^;]*from\s+['"](three|three\/[^'"]+|@\/lib\/racketModel|@\/lib\/racketStage|\.\/racketModel|\.\/racketStage)['"]/m.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
