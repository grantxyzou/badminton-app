import { describe, it, expect, beforeEach } from 'vitest';
import { GET, PATCH } from '@/app/api/admin/settings/route';
import { resetMockStore, setupAdminPin, seedTestAdminMember, seedGroup, makeRequest, makeAdminRequest, getStore } from './helpers';

/**
 * The club's late-cancellation window (docs/plans/late-cancel-fee.md): whole
 * hours 1–168 on the GROUP record, `null` to switch it off. It is read and
 * written there whether or not multi-group is on, like the pay-to address.
 */
const URL = 'http://localhost:3000/api/admin/settings';
const groupSettings = () =>
  ((getStore()['groups'] as Array<{ id: string; settings: Record<string, unknown> }>).find((g) => g.id === 'bpm')!).settings;

describe('/api/admin/settings — lateCancelHours', () => {
  beforeEach(async () => {
    resetMockStore();
    setupAdminPin();
    await seedTestAdminMember();
  });

  it('is admin-only', async () => {
    seedGroup('bpm');
    expect((await PATCH(makeRequest('PATCH', URL, { lateCancelHours: 48 }))).status).toBe(401);
  });

  it('reads null while off, saves hours to the group record, and reads them back', async () => {
    seedGroup('bpm');
    expect((await (await GET(makeAdminRequest('GET', URL))).json()).lateCancelHours).toBeNull();
    expect((await PATCH(makeAdminRequest('PATCH', URL, { lateCancelHours: 24 }))).status).toBe(200);
    expect(groupSettings().lateCancelHours).toBe(24);
    expect((await (await GET(makeAdminRequest('GET', URL))).json()).lateCancelHours).toBe(24);
  });

  it('switches off with null by removing the key, not leaving a value behind', async () => {
    seedGroup('bpm', { settings: { skipDates: [], maxPlayers: 12, lateCancelHours: 48 } });
    expect((await PATCH(makeAdminRequest('PATCH', URL, { lateCancelHours: null }))).status).toBe(200);
    expect('lateCancelHours' in groupSettings()).toBe(false);
  });

  it('refuses a value outside whole hours 1–168, and saves nothing', async () => {
    seedGroup('bpm');
    for (const bad of [0, 169, 1.5, '48', -3]) {
      const res = await PATCH(makeAdminRequest('PATCH', URL, { lateCancelHours: bad }));
      expect(res.status).toBe(400);
    }
    expect('lateCancelHours' in groupSettings()).toBe(false);
  });

  it('answers 409 rather than a 200 that saved nothing when there is no group record', async () => {
    const res = await PATCH(makeAdminRequest('PATCH', URL, { lateCancelHours: 48 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'no_group' });
  });
});
