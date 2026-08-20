import { describe, it, expect, beforeEach } from 'vitest';
import { PATCH, GET } from '../app/api/equipment/gear/route';
import { resetMockStore, seedMember, setupAdminPin, makeRequest, memberCookieValue } from './helpers';

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
