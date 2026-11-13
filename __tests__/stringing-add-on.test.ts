import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as REQUEST } from '../app/api/stringing/requests/route';
import { POST as CREATE } from '../app/api/stringing/jobs/route';
import { PATCH as SHOP } from '../app/api/stringing/shop/route';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedMember,
  seedTestAdminMember,
  seedGroup,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
} from './helpers';
import { isOpenStringingJob, stringingServiceOnFor } from '../lib/stringingService';

/**
 * Stringing as an add-on a club switches (docs/plans/stringing-add-on.md,
 * phase 1). A club with it off takes no new request — from a member or from
 * the bench — and answers exactly as the deployment flag off does. A club that
 * never chose reads as BPM, which strings.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const flagBefore = process.env[FLAG];

const VALID = { racketLabel: 'Astrox 99 Pro', stringLabel: 'BG80 white', tensionMains: 26, tensionCrosses: 28 };

function playerReq(name: string) {
  const rows = (getStore()['members'] ?? []) as Array<{ name?: string }>;
  if (!rows.some((m) => m.name === name)) seedMember(name);
  return makeRequest('POST', 'http://x/api/stringing/requests', VALID, { Cookie: `member_session=${memberCookieValue(name)}` });
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  process.env[FLAG] = 'true';
  await SHOP(makeAdminRequest('PATCH', 'http://x/api/stringing/shop', { open: true }));
});
afterEach(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});

describe('stringingServiceOnFor', () => {
  it('is on for a club with no record or no run (BPM), off when the club switched it off or the flag is off', async () => {
    expect(await stringingServiceOnFor('bpm')).toBe(true);
    seedGroup('bpm');
    expect(await stringingServiceOnFor('bpm')).toBe(true);
    seedGroup('six', { settings: { skipDates: [], maxPlayers: 32, run: { style: 'members_first' } } });
    expect(await stringingServiceOnFor('six')).toBe(false);
    seedGroup('off', { settings: { skipDates: [], maxPlayers: 12, run: { style: 'first_come', stringing: 'off' } } });
    expect(await stringingServiceOnFor('off')).toBe(false);
    delete process.env[FLAG];
    expect(await stringingServiceOnFor('bpm')).toBe(false);
  });
});

describe('a club with stringing off takes no new job', () => {
  it('a member’s request answers as the flag off does, and nothing is written', async () => {
    seedGroup('bpm', { settings: { skipDates: [], maxPlayers: 12, run: { style: 'first_come', stringing: 'off' } } });
    const res = await REQUEST(playerReq('wei'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(getStore()['stringingJobs'] ?? []).toHaveLength(0);
  });

  it('a member’s request still goes through in a club that strings', async () => {
    seedGroup('bpm');
    expect((await REQUEST(playerReq('wei'))).status).toBe(201);
  });

  it('the bench’s own create is refused before the body is read', async () => {
    seedGroup('bpm', { settings: { skipDates: [], maxPlayers: 12, run: { style: 'first_come', stringing: 'off' } } });
    expect((await CREATE(makeAdminRequest('POST', 'http://x/api/stringing/jobs', {}))).status).toBe(404);
    // With the service on the same empty body reaches validation instead.
    seedGroup('bpm');
    (getStore()['groups'] as unknown[]).splice(0, 1);
    expect((await CREATE(makeAdminRequest('POST', 'http://x/api/stringing/jobs', {}))).status).toBe(400);
  });
});

describe('isOpenStringingJob — what keeps the service from being switched off', () => {
  const base = { status: 'requested', priceCents: 3000, paidAt: null, archivedAt: null, cancelledAt: null };
  it('a racket still on the bench, or finished and unpaid, is open', () => {
    for (const status of ['requested', 'received', 'strung', 'ready']) expect(isOpenStringingJob({ ...base, status })).toBe(true);
    expect(isOpenStringingJob({ ...base, status: 'picked_up' })).toBe(true);
    expect(isOpenStringingJob({ ...base, status: 'ready', archivedAt: '2026-11-01T00:00:00Z' })).toBe(true);
  });
  it('a cancelled job, a paid one collected, or one with no price collected is not', () => {
    expect(isOpenStringingJob({ ...base, cancelledAt: '2026-11-01T00:00:00Z' })).toBe(false);
    expect(isOpenStringingJob({ ...base, status: 'picked_up', paidAt: '2026-11-01T00:00:00Z' })).toBe(false);
    expect(isOpenStringingJob({ ...base, status: 'picked_up', priceCents: null })).toBe(false);
  });
});
