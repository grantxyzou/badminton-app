import { describe, it, expect, beforeEach } from 'vitest';
import { POST, GET, PATCH, PUT, DELETE } from '../app/api/equipment/gear/route';
import { resetMockStore, setupAdminPin, seedMember, makeRequest, memberCookieValue } from './helpers';
import { getContainer } from '../lib/cosmos';
import { currentString, pinLooseStrings, stringOn, stringsOn } from '../lib/activeRacket';
import { setupLines } from '../lib/gearSetup';
import type { GearItem, PlayerGear } from '../lib/types';

/**
 * Grant, 2026-11-05: "on the equipment card the string should follow the
 * rackets. Today when I switch racket the string and tension stays with the
 * new racket which is incorrect." A string names the racket it is on
 * (`GearItem.racketId`); a swap shows the new racket's own string.
 */

const URL = 'http://localhost:3000/api/equipment/gear';
const cookie = { Cookie: `member_session=${memberCookieValue('Lin')}` };

const post = (item: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  POST(makeRequest('POST', URL, { name: 'Lin', item, ...extra }, cookie));
const put = (item: Record<string, unknown>) => PUT(makeRequest('PUT', URL, { name: 'Lin', item }, cookie));
const swap = (activeRacketId: string) => PATCH(makeRequest('PATCH', URL, { name: 'Lin', activeRacketId }, cookie));
const del = (itemId: string) => DELETE(makeRequest('DELETE', `${URL}?name=Lin&itemId=${itemId}`, undefined, cookie));

async function gear(): Promise<PlayerGear> {
  const res = await GET(makeRequest('GET', `${URL}?name=Lin`, undefined, cookie));
  return (await res.json()).gear as PlayerGear;
}
const idOf = (g: PlayerGear, catalogId: string) => g.items.find((i) => i.catalogId === catalogId)!.id;

const r = (id: string): GearItem => ({ id, catalogId: id, category: 'racket', label: id });
const s = (id: string, extra: Partial<GearItem> = {}): GearItem => ({ id, catalogId: id, category: 'string', label: id, ...extra });

describe('the string on a racket (pure)', () => {
  it('a racket shows the string that names it, not the newest in the bag', () => {
    const g = { id: 'g', memberId: 'm', activeRacketId: 'b', items: [r('a'), r('b'), s('s1', { racketId: 'b' }), s('s2', { racketId: 'a' })] } as PlayerGear;
    expect(currentString(g)?.id).toBe('s1');
    expect(stringOn(g, r('a'))?.id).toBe('s2');
  });

  it('a racket with no string of its own shows none, even with strings in the bag', () => {
    const g = { id: 'g', memberId: 'm', activeRacketId: 'b', items: [r('a'), r('b'), s('s1', { racketId: 'a' })] } as PlayerGear;
    expect(currentString(g)).toBeNull();
    expect(setupLines(g).string).toBeNull();
  });

  it('a legacy string (no racket named) is the ACTIVE racket\'s and no other', () => {
    const g = { id: 'g', memberId: 'm', activeRacketId: 'a', items: [r('a'), r('b'), s('old')] } as PlayerGear;
    expect(currentString(g)?.id).toBe('old');
    expect(stringOn(g, r('b'))).toBeNull();
    expect(stringsOn(g, r('b'))).toEqual([]);
  });

  it('a string naming a racket that is gone reads as loose', () => {
    const g = { id: 'g', memberId: 'm', activeRacketId: 'a', items: [r('a'), s('s1', { racketId: 'deleted' })] } as PlayerGear;
    expect(currentString(g)?.id).toBe('s1');
  });

  it('with no racket at all, the newest string is the member\'s', () => {
    const g = { id: 'g', memberId: 'm', items: [s('s1'), s('s2')] } as PlayerGear;
    expect(currentString(g)?.id).toBe('s2');
  });

  it('pinLooseStrings writes the old racket onto loose strings only, and is a no-op when there are none', () => {
    const items = [r('a'), r('b'), s('loose'), s('mine', { racketId: 'b' })];
    const pinned = pinLooseStrings(items, r('a'));
    expect(pinned.find((i) => i.id === 'loose')?.racketId).toBe('a');
    expect(pinned.find((i) => i.id === 'mine')?.racketId).toBe('b');
    const clean = [r('a'), s('x', { racketId: 'a' })];
    expect(pinLooseStrings(clean, r('a'))).toBe(clean);
  });
});

describe('the gear route keeps a string on its racket', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    seedMember('Lin', { id: 'member-lin' });
  });

  it('a swap shows the new racket\'s string and tension; swapping back restores the first', async () => {
    await post({ catalogId: 'racket-a', category: 'racket', label: 'Astrox 88D' });
    await post({ catalogId: 'string-bg65', category: 'string', label: 'Yonex BG65' });
    let g = await gear();
    await put({ id: idOf(g, 'string-bg65'), catalogId: 'string-bg65', category: 'string', label: 'Yonex BG65', tensionLbs: 24 });
    await post({ catalogId: 'racket-b', category: 'racket', label: 'Nanoflare 800' });
    g = await gear();
    const a = idOf(g, 'racket-a');
    const b = idOf(g, 'racket-b');

    expect((await swap(b)).status).toBe(200);
    g = await gear();
    expect(setupLines(g).racket?.id).toBe(b);
    expect(setupLines(g).string).toBeNull();

    expect((await swap(a)).status).toBe(200);
    g = await gear();
    expect(setupLines(g).string?.label).toBe('Yonex BG65');
    expect(setupLines(g).string?.tensionLbs).toBe(24);
  });

  it('the same string may go on two rackets, each at its own tension', async () => {
    await post({ catalogId: 'racket-a', category: 'racket', label: 'A' });
    await post({ catalogId: 'racket-b', category: 'racket', label: 'B' });
    let g = await gear();
    const a = idOf(g, 'racket-a');
    const b = idOf(g, 'racket-b');
    expect((await post({ catalogId: 'string-bg65', category: 'string', label: 'BG65', racketId: a })).status).toBe(200);
    expect((await post({ catalogId: 'string-bg65', category: 'string', label: 'BG65', racketId: b })).status).toBe(200);
    // …but not twice on one racket.
    expect((await post({ catalogId: 'string-bg65', category: 'string', label: 'BG65', racketId: b })).status).toBe(409);

    g = await gear();
    const onB = g.items.find((i) => i.category === 'string' && i.racketId === b)!;
    await put({ id: onB.id, catalogId: 'string-bg65', category: 'string', label: 'BG65', tensionLbs: 28 });
    g = await gear();
    expect(g.items.find((i) => i.category === 'string' && i.racketId === a)?.tensionLbs).toBeUndefined();
    expect(g.items.find((i) => i.category === 'string' && i.racketId === b)?.tensionLbs).toBe(28);
    // The restring is logged against the racket it went on.
    expect(g.stringLog?.at(-1)?.racketItemId).toBe(b);
  });

  it('a string added with no racket named goes on the racket in play', async () => {
    await post({ catalogId: 'racket-a', category: 'racket', label: 'A' });
    await post({ catalogId: 'string-bg65', category: 'string', label: 'BG65' });
    const g = await gear();
    expect(g.items.find((i) => i.category === 'string')?.racketId).toBe(idOf(g, 'racket-a'));
  });

  it('a legacy string is pinned to the racket it was on when the member first swaps', async () => {
    await post({ catalogId: 'racket-a', category: 'racket', label: 'A' });
    await post({ catalogId: 'racket-b', category: 'racket', label: 'B' });
    let g = await gear();
    // Written before the link existed: a string naming no racket.
    await getContainer('playerGear').items.upsert({
      ...g,
      items: [...g.items, { id: 'legacy-s', catalogId: 'string-bg80', category: 'string', label: 'BG80', tensionLbs: 26 }],
    });
    g = await gear();
    const a = idOf(g, 'racket-a');
    expect(setupLines(g).string?.id).toBe('legacy-s');

    await swap(idOf(g, 'racket-b'));
    g = await gear();
    expect(g.items.find((i) => i.id === 'legacy-s')?.racketId).toBe(a);
    expect(setupLines(g).string).toBeNull();
  });

  it('a racket leaves with the string on it', async () => {
    await post({ catalogId: 'racket-a', category: 'racket', label: 'A' });
    await post({ catalogId: 'racket-b', category: 'racket', label: 'B' });
    let g = await gear();
    const a = idOf(g, 'racket-a');
    const b = idOf(g, 'racket-b');
    await post({ catalogId: 'string-bg65', category: 'string', label: 'BG65', racketId: a });
    await post({ catalogId: 'string-bg80', category: 'string', label: 'BG80', racketId: b });
    expect((await del(b)).status).toBe(200);
    g = await gear();
    expect(g.items.filter((i) => i.category === 'string').map((i) => i.label)).toEqual(['BG65']);
  });
});
