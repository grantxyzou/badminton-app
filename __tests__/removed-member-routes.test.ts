import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  seedMember,
  seedGroup,
  seedMembership,
  setupAdminPin,
  makeRequest,
  memberCookieValue,
} from './helpers';
import { GET as eligibleGet } from '@/app/api/kudos/eligible/route';
import { POST as kudosPost } from '@/app/api/kudos/route';
import { POST as requestPost } from '@/app/api/stringing/requests/route';

/**
 * A REMOVED member's cookie is a cookie for nobody (security review,
 * 2026-10-24). Three routes checked only the cookie's signature, so for the
 * thirty days a `member_session` lives a removed member could still list
 * their co-players, send kudos, and file a stringing request that pushes
 * every admin on the roster. Each now re-reads the membership through
 * `requireGroupMember`, the same gate every other member route uses.
 *
 * Both halves of the gate: flag off, `Member.active`; flag on, the
 * membership's status in the claimed club.
 */
const MULTI = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const STRINGING = 'NEXT_PUBLIC_FLAG_STRINGING';
const before = { multi: process.env[MULTI], stringing: process.env[STRINGING] };

const cookieFor = (name: string, id: string, groupId = 'bpm') => ({
  Cookie: `member_session=${memberCookieValue(name, id, 3600, groupId)}`,
});

const REQUEST = { racketLabel: 'Astrox 99', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28 };

async function statuses(headers: Record<string, string>) {
  return {
    eligible: (await eligibleGet(makeRequest('GET', 'http://x/api/kudos/eligible', undefined, headers))).status,
    kudos: (await kudosPost(makeRequest('POST', 'http://x/api/kudos', { recipientName: 'Lin', tag: 'clutch' }, headers))).status,
    request: (await requestPost(makeRequest('POST', 'http://x/api/stringing/requests', REQUEST, headers))).status,
  };
}

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env[STRINGING] = 'true';
  delete process.env[MULTI];
});
afterEach(() => {
  for (const [k, v] of [[MULTI, before.multi], [STRINGING, before.stringing]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('a removed member’s cookie is refused on kudos/eligible, kudos and stringing/requests', () => {
  it('flag off: `Member.active: false` is a 401 on all three', async () => {
    const wei = seedMember('Wei', { active: false });
    const res = await statuses(cookieFor('Wei', wei.id));
    expect(res).toEqual({ eligible: 401, kudos: 401, request: 401 });
    expect(getStore()['stringingJobs'] ?? []).toHaveLength(0);
    expect(getStore()['kudos'] ?? []).toHaveLength(0);
  });

  it('flag off: an active member passes the gate (the vacuity guard)', async () => {
    const wei = seedMember('Wei');
    const res = await statuses(cookieFor('Wei', wei.id));
    // Past the gate: eligible answers, kudos refuses on co-play (not auth),
    // the request refuses on the closed shop (not auth).
    expect(res.eligible).toBe(200);
    expect(res.kudos).not.toBe(401);
    expect(res.request).toBe(409);
  });

  it('flag on: a `removed` membership in the claimed club is a 401, an active one in the other club does not help', async () => {
    process.env[MULTI] = 'true';
    const wei = seedMember('Wei');
    seedGroup('bpm', { ownerMemberId: 'grant' });
    seedGroup('club-x', { ownerMemberId: 'someone' });
    seedMembership('bpm', wei.id, { name: 'Wei', status: 'removed', reserveName: false });
    seedMembership('club-x', wei.id, { name: 'Wei' });
    expect(await statuses(cookieFor('Wei', wei.id, 'bpm'))).toEqual({ eligible: 401, kudos: 401, request: 401 });
    // The same person, under the club that still has them, is let through.
    expect((await statuses(cookieFor('Wei', wei.id, 'club-x'))).eligible).not.toBe(401);
  });
});
