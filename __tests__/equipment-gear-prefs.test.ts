import { describe, it, expect, beforeEach } from 'vitest';
import { PATCH, GET, POST, PUT } from '../app/api/equipment/gear/route';
import { resetMockStore, seedMember, seedAdminMember, setupAdminPin, makeRequest, makeAdminRequest, memberCookieValue } from './helpers';

const BASE = 'http://localhost:3000/api/equipment/gear';

describe('gear preferences', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
  });

  it('persists playFormat and budgetMaxCad', async () => {
    // memberCookieValue('Lin') defaults its cookie memberId to `member-lin`,
    // so the seeded member must share that id or authorizeBagWrite's
    // caller.memberId !== memberId check 401s (see equipment-gear-bag.test.ts
    // for the same explicit-id pattern).
    seedMember('Lin', { id: 'member-lin' });
    const cookie = { Cookie: `member_session=${memberCookieValue('Lin')}` };
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', playFormat: 'doubles' }, cookie));
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', budgetMaxCad: 200 }, cookie));
    const body = await (await GET(makeRequest('GET', `${BASE}?name=Lin`, undefined, cookie))).json();
    expect(body.gear.playFormat).toBe('doubles');
    expect(body.gear.budgetMaxCad).toBe(200);
  });

  it('rejects an unknown playFormat rather than storing it', async () => {
    seedMember('Lin');
    const cookie = { Cookie: `member_session=${memberCookieValue('Lin')}` };
    const res = await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', playFormat: 'mixed' }, cookie));
    expect(res.status).toBe(400);
  });

  it('rejects a negative or absurd budget', async () => {
    seedMember('Lin');
    const cookie = { Cookie: `member_session=${memberCookieValue('Lin')}` };
    expect((await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', budgetMaxCad: -5 }, cookie))).status).toBe(400);
    expect((await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', budgetMaxCad: 99999 }, cookie))).status).toBe(400);
  });
});

/**
 * The racket-fit questionnaire (spec `2026-09-07-racket-fit-design.md`, Data).
 * Five optional fields on the gear doc, all asked rather than inferred. Two of
 * the cases below pin defects the plan named in advance: `writeGearDoc`
 * rebuilds the document from an explicit field list, so a field left off it
 * is silently dropped by the NEXT bag write; and the gear GET is public by
 * name, so a health-adjacent answer must be stripped for anyone but the owner.
 */
describe('fit questionnaire fields', () => {
  const cookie = { Cookie: `member_session=${memberCookieValue('Lin')}` };

  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    seedMember('Lin', { id: 'member-lin' });
    // The admin GET below goes through the fresh role re-check, which reads
    // the admin's member row — a cookie alone is not enough.
    seedAdminMember();
  });

  async function read(headers?: Record<string, string>) {
    return (await (await GET(makeRequest('GET', `${BASE}?name=Lin`, undefined, headers))).json()).gear;
  }

  it('persists every fit field and stamps fitUpdatedAt', async () => {
    const res = await PATCH(makeRequest('PATCH', BASE, {
      name: 'Lin', fitGoal: 'more_power', fitSwing: 'fast', fitArmComfort: 'sometimes_sore', fitGrip: 'G5', stringBudgetMaxCad: 20,
    }, cookie));
    expect(res.status).toBe(200);
    const gear = await read(cookie);
    expect(gear.fitGoal).toBe('more_power');
    expect(gear.fitSwing).toBe('fast');
    expect(gear.fitArmComfort).toBe('sometimes_sore');
    expect(gear.fitGrip).toBe('G5');
    expect(gear.stringBudgetMaxCad).toBe(20);
    expect(typeof gear.fitUpdatedAt).toBe('string');
    expect(Number.isNaN(Date.parse(gear.fitUpdatedAt))).toBe(false);
  });

  it('a fit-only PATCH needs no activeRacketId', async () => {
    const res = await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', fitGoal: 'happy' }, cookie));
    expect(res.status).toBe(200);
  });

  it('null deletes a fit field and leaves the others alone', async () => {
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', fitGoal: 'faster', fitArmComfort: 'often_sore' }, cookie));
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', fitArmComfort: null }, cookie));
    const gear = await read(cookie);
    expect(gear.fitArmComfort).toBeUndefined();
    expect(gear.fitGoal).toBe('faster');
  });

  it('rejects a value outside the vocabulary rather than storing it', async () => {
    for (const body of [
      { fitGoal: 'more_spin' }, { fitSwing: 'fastest' }, { fitArmComfort: 'fine_thanks' }, { fitGrip: 'G7' },
      { stringBudgetMaxCad: -1 }, { stringBudgetMaxCad: 99999 }, { stringBudgetMaxCad: 'twenty' },
    ]) {
      const res = await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', ...body }, cookie));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await read(cookie)) ?? null).toBeNull();
  });

  it('fit answers survive a bag write (writeGearDoc rebuilds the doc from a field list)', async () => {
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', fitGoal: 'more_control', fitSwing: 'medium', fitGrip: 'G4' }, cookie));
    const post = await POST(makeRequest('POST', BASE, {
      name: 'Lin', item: { catalogId: 'racket-yonex-astrox-88d-pro', category: 'racket', label: 'Yonex Astrox 88D Pro' },
    }, cookie));
    expect(post.status).toBe(200);
    const gear = await read(cookie);
    expect(gear.items).toHaveLength(1);
    expect(gear.fitGoal).toBe('more_control');
    expect(gear.fitSwing).toBe('medium');
    expect(gear.fitGrip).toBe('G4');
  });

  it('the comfort answer reaches only the owner and an admin — everyone else is refused the whole doc', async () => {
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', fitGoal: 'happy', fitArmComfort: 'often_sore' }, cookie));

    // The GET was public by name and stripped only this field. It is now
    // owner-or-admin, so a non-owner sees none of the doc at all.
    expect((await GET(makeRequest('GET', `${BASE}?name=Lin`))).status).toBe(403);
    expect((await GET(makeRequest('GET', `${BASE}?name=Lin`, undefined, { Cookie: `member_session=${memberCookieValue('Viktor')}` }))).status).toBe(403);

    expect((await read(cookie)).fitArmComfort).toBe('often_sore');

    const admin = (await (await GET(makeAdminRequest('GET', `${BASE}?name=Lin`))).json()).gear;
    expect(admin.fitArmComfort).toBe('often_sore');
    expect(admin).not.toHaveProperty('fitArmComfortRedacted');
  });

  it('a DEMOTED admin no longer reads the comfort answer, cookie or no cookie', async () => {
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', fitArmComfort: 'often_sore' }, cookie));
    const admin = (await (await GET(makeAdminRequest('GET', `${BASE}?name=Lin`))).json()).gear;
    expect(admin.fitArmComfort).toBe('often_sore');
    seedAdminMember({ role: 'member' });
    const demoted = (await (await GET(makeAdminRequest('GET', `${BASE}?name=Lin`))).json()).gear;
    expect(demoted).not.toHaveProperty('fitArmComfort');
    expect(demoted).not.toHaveProperty('fitArmComfortRedacted');
  });

  it('fitUpdatedAt moves only when an answer actually changes — not on a re-send, not on the string budget', async () => {
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', fitGoal: 'faster' }, cookie));
    const first = (await read(cookie)).fitUpdatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', fitGoal: 'faster' }, cookie));
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', stringBudgetMaxCad: 25 }, cookie));
    expect((await read(cookie)).fitUpdatedAt).toBe(first);
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', fitGoal: 'more_power' }, cookie));
    expect((await read(cookie)).fitUpdatedAt).not.toBe(first);
  });

  // A lapsed owner used to get the stripped doc plus a `fitArmComfortRedacted`
  // marker. With the read owner-or-admin, a cookie past its TTL is refused like
  // any other non-owner: the card locks and offers Sign in, which is the only
  // thing that helps.
  it('refuses the LAPSED OWNER rather than showing a redacted bag', async () => {
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', fitArmComfort: 'sometimes_sore' }, cookie));
    const lapsed = await GET(makeRequest('GET', `${BASE}?name=Lin`, undefined, { Cookie: `member_session=${memberCookieValue('Lin', 'member-lin', -60)}` }));
    expect(lapsed.status).toBe(403);
    expect(JSON.stringify(await lapsed.json())).not.toContain('sore');
  });

  it('preference writes do not spend the bag limiter — a questionnaire cannot lock "Add to my equipment"', async () => {
    // Same IP for every call so the buckets are the ones under test.
    const headers = { ...cookie, 'X-Client-IP': '10.9.9.9' };
    for (let i = 0; i < 25; i++) {
      const res = await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', fitGoal: i % 2 ? 'faster' : 'more_power' }, headers));
      expect(res.status, `pref write #${i + 1}`).toBe(200);
    }
    const post = await POST(makeRequest('POST', BASE, {
      name: 'Lin', item: { catalogId: 'racket-yonex-astrox-88d-pro', category: 'racket', label: 'Yonex Astrox 88D Pro' },
    }, headers));
    expect(post.status).toBe(200);
  });
});

/**
 * How a racket typed by name feels (Grant, 2026-09-14). Stored on the bag item
 * through PATCH `itemFeel`, so it leaves with the racket — and it must survive
 * PUT, which rebuilds an item from the wire and would otherwise drop it.
 */
describe('typed racket feel', () => {
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

  async function addTyped(label = 'Victor Auraspeed 90S') {
    const res = await POST(makeRequest('POST', BASE, { name: 'Lin', makeActive: true, item: { catalogId: null, category: 'racket', label } }, cookie));
    expect(res.status).toBe(200);
    return (await read()).items.find((i: { label: string }) => i.label === label).id as string;
  }

  it('stores the answers on the typed racket, and an empty set clears them', async () => {
    const id = await addTyped();
    const res = await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', itemFeel: { itemId: id, balance: 'Head-heavy', flex: 'Stiff' } }, cookie));
    expect(res.status).toBe(200);
    expect((await read()).items[0].feel).toEqual({ balance: 'Head-heavy', flex: 'Stiff' });

    // "Don't know" on every row is an answer too: the whole set is replaced.
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', itemFeel: { itemId: id } }, cookie));
    expect((await read()).items[0].feel).toBeUndefined();
  });

  it('refuses an answer outside the vocabulary rather than storing it', async () => {
    const id = await addTyped();
    const res = await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', itemFeel: { itemId: id, flex: 'Extra Stiff' } }, cookie));
    expect(res.status).toBe(400);
    expect((await read()).items[0].feel).toBeUndefined();
  });

  it('refuses feel on a CATALOG racket — its real specs are already known', async () => {
    await POST(makeRequest('POST', BASE, { name: 'Lin', item: { catalogId: 'racket-yonex-astrox-88d-pro', category: 'racket', label: 'Yonex Astrox 88D Pro' } }, cookie));
    const id = (await read()).items[0].id;
    const res = await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', itemFeel: { itemId: id, balance: 'Even', flex: 'Medium' } }, cookie));
    expect(res.status).toBe(404);
  });

  it('is dropped when the typed racket is later picked from the catalog', async () => {
    const id = await addTyped('Yonex Astrox 88D Pro');
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', itemFeel: { itemId: id, balance: 'Even', flex: 'Medium' } }, cookie));
    await POST(makeRequest('POST', BASE, { name: 'Lin', item: { catalogId: 'racket-yonex-astrox-88d-pro', category: 'racket', label: 'Yonex Astrox 88D Pro' } }, cookie));
    const item = (await read()).items[0];
    expect(item.id).toBe(id);
    expect(item.catalogId).toBe('racket-yonex-astrox-88d-pro');
    expect(item.feel).toBeUndefined();
  });

  it('survives a PUT of the same racket, which rebuilds the item from the wire', async () => {
    const id = await addTyped();
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', itemFeel: { itemId: id, balance: 'Even', flex: 'Medium', weight: '4U' } }, cookie));
    const put = await PUT(makeRequest('PUT', BASE, { name: 'Lin', item: { catalogId: null, category: 'racket', label: 'Victor Auraspeed 90S' } }, cookie));
    expect(put.status).toBe(200);
    expect((await read()).items[0].feel).toEqual({ balance: 'Even', flex: 'Medium', weight: '4U' });
  });
});
