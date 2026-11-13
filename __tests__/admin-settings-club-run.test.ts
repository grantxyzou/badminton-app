import { describe, it, expect, beforeEach } from 'vitest';
import { GET, PATCH } from '@/app/api/admin/settings/route';
import { resetMockStore, setupAdminPin, seedTestAdminMember, seedGroup, seedDoc, makeRequest, makeAdminRequest, getStore } from './helpers';

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
      membersFirst: null,
      guests: 0,
      stringing: 'on',
    });
  });

  it('saves to the group record with the style worked out, and reads it back', async () => {
    seedGroup('bpm');
    const membersFirst = { daysBefore: 5, time: '23:59' };
    const res = await PATCH(
      makeAdminRequest('PATCH', URL, { run: { style: 'first_come', playersPerCourt: 8, money: 'off', membersFirst, guests: 2 } }),
    );
    expect(res.status).toBe(200);
    expect(groupSettings().run).toEqual({ style: 'members_first', playersPerCourt: 8, money: 'off', membersFirst, guests: 2, stringing: 'on' });
    // The old switch is written beside it for rollback.
    expect(groupSettings().guestsAllowed).toBe(true);
    expect((await (await GET(makeAdminRequest('GET', URL))).json()).run.style).toBe('members_first');
  });

  it('keeps the club’s members-first window when a save does not name one (a screen from before it)', async () => {
    const membersFirst = { daysBefore: 4, time: '21:00' };
    seedGroup('bpm', { settings: { skipDates: [], maxPlayers: 12, run: { style: 'custom', playersPerCourt: 8, money: 'off', membersFirst } } });
    expect((await PATCH(makeAdminRequest('PATCH', URL, { run: { playersPerCourt: 8, money: 'split' } }))).status).toBe(200);
    expect(groupSettings().run).toMatchObject({ money: 'split', membersFirst });
    expect((await PATCH(makeAdminRequest('PATCH', URL, { run: { playersPerCourt: 8, money: 'split', membersFirst: null } }))).status).toBe(200);
    expect((groupSettings().run as { membersFirst?: unknown }).membersFirst).toBeNull();
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

/**
 * Stringing is an add-on (docs/plans/stringing-add-on.md, phase 1). It is
 * switched off only with nothing left on the bench and nothing owed for it.
 */
describe('/api/admin/settings — the stringing switch', () => {
  const off = { playersPerCourt: null, money: 'split', stringing: 'off' };
  const job = (id: string, over: Record<string, unknown>) =>
    seedDoc('stringingJobs', { id, memberId: 'm1', groupId: 'bpm', status: 'requested', priceCents: 3000, paidAt: null, archivedAt: null, cancelledAt: null, ...over });

  beforeEach(async () => {
    resetMockStore();
    setupAdminPin();
    await seedTestAdminMember();
    seedGroup('bpm');
  });

  it('switches off with an empty bench, and a later save that does not name it keeps it off', async () => {
    expect((await PATCH(makeAdminRequest('PATCH', URL, { run: off }))).status).toBe(200);
    expect((groupSettings().run as { stringing?: string }).stringing).toBe('off');
    expect((await PATCH(makeAdminRequest('PATCH', URL, { run: { playersPerCourt: 8, money: 'split' } }))).status).toBe(200);
    expect((groupSettings().run as { stringing?: string }).stringing).toBe('off');
  });

  it('refuses to switch off while a racket is on the bench or a finished job is unpaid, and saves nothing', async () => {
    job('j1', { status: 'received' });
    job('j2', { status: 'picked_up', paidAt: null });
    const res = await PATCH(makeAdminRequest('PATCH', URL, { run: off }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'stringing_open_jobs', open: 2 });
    expect('run' in groupSettings()).toBe(false);
  });

  it('a paid, cancelled or archived-and-paid job does not hold it on', async () => {
    job('j1', { status: 'picked_up', paidAt: '2026-11-01T00:00:00.000Z' });
    job('j2', { status: 'requested', cancelledAt: '2026-11-01T00:00:00.000Z' });
    job('j3', { status: 'ready', archivedAt: '2026-11-02T00:00:00.000Z', paidAt: '2026-11-02T00:00:00.000Z' });
    // Another club's open job is that club's.
    job('j4', { status: 'received', groupId: 'other' });
    expect((await PATCH(makeAdminRequest('PATCH', URL, { run: off }))).status).toBe(200);
  });
});
