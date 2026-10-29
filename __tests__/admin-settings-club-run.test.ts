import { describe, it, expect, beforeEach } from 'vitest';
import { GET, PATCH } from '@/app/api/admin/settings/route';
import { resetMockStore, setupAdminPin, seedTestAdminMember, seedGroup, makeRequest, makeAdminRequest, getStore } from './helpers';

/**
 * How the club runs (lib/clubRun.ts), stored on the GROUP record only, like the
 * late-cancel window. The whole object or nothing; the style is worked out
 * from the values.
 */
const URL = 'http://localhost:3000/api/admin/settings';
const groupSettings = () =>
  ((getStore()['groups'] as Array<{ id: string; settings: Record<string, unknown> }>).find((g) => g.id === 'bpm')!).settings;

describe('/api/admin/settings — run', () => {
  beforeEach(async () => {
    resetMockStore();
    setupAdminPin();
    await seedTestAdminMember();
  });

  it('is admin-only', async () => {
    seedGroup('bpm');
    expect((await PATCH(makeRequest('PATCH', URL, { run: { playersPerCourt: 8, money: 'off' } }))).status).toBe(401);
  });

  it('reads BPM defaults for a club that has never set it', async () => {
    seedGroup('bpm');
    expect((await (await GET(makeAdminRequest('GET', URL))).json()).run).toEqual({
      style: 'first_come',
      playersPerCourt: null,
      money: 'split',
    });
  });

  it('saves to the group record with the style worked out, and reads it back', async () => {
    seedGroup('bpm');
    const res = await PATCH(makeAdminRequest('PATCH', URL, { run: { style: 'first_come', playersPerCourt: 8, money: 'off' } }));
    expect(res.status).toBe(200);
    expect(groupSettings().run).toEqual({ style: 'members_first', playersPerCourt: 8, money: 'off' });
    expect((await (await GET(makeAdminRequest('GET', URL))).json()).run.style).toBe('members_first');
  });

  it('refuses a partial or invalid value and saves nothing', async () => {
    seedGroup('bpm');
    for (const bad of [{ money: 'off' }, { playersPerCourt: 40, money: 'off' }, 'members_first', { playersPerCourt: 8, money: 'off', extra: 1 }]) {
      expect((await PATCH(makeAdminRequest('PATCH', URL, { run: bad }))).status).toBe(400);
    }
    expect('run' in groupSettings()).toBe(false);
  });

  it('answers 409 rather than a 200 that saved nothing when there is no group record', async () => {
    const res = await PATCH(makeAdminRequest('PATCH', URL, { run: { playersPerCourt: 8, money: 'off' } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'no_group' });
  });
});
