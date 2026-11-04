import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  seedGroup,
  seedMember,
  seedMembership,
  makeRequest,
  memberCookieValue,
  getTestAdminName,
  ADMIN_MEMBER_ID,
} from './helpers';
import { GET as getMe } from '@/app/api/members/me/route';
import { profileChip, readRank } from '@/components/ProfileTab';

/**
 * The Profile card's chip (roles v2, docs/plans/roles-v2.md): this club's
 * RANK — Organiser or Admin, a Player shows none. Read from the membership,
 * so the same person can hold a different rank in two clubs. Job badges
 * (Stringer, Gifter) are not on the card, by decision (Grant, 2026-11-04).
 */
const MULTI = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[MULTI];

let zach: { id: string };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[MULTI] = 'true';
  seedGroup('bpm', { ownerMemberId: 'grant' });
  seedGroup('club-x', { ownerMemberId: 'someone' });
  seedMembership('bpm', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'admin' });
  zach = seedMember('Zach', { canString: true, canGift: true });
  seedMembership('bpm', zach.id, { name: 'Zach', role: 'member' });
  seedMembership('club-x', zach.id, { name: 'Zachary', role: 'member' });
});
afterEach(() => {
  if (before === undefined) delete process.env[MULTI];
  else process.env[MULTI] = before;
});

const membershipOf = (groupId: string, memberId: string) =>
  (getStore()['memberships'] as Array<Record<string, unknown> & { id: string }>).find((m) => m.id === `${groupId}:${memberId}`)!;

async function rankAs(name: string, groupId: string) {
  const res = await getMe(
    makeRequest('GET', `http://x/api/members/me?name=${encodeURIComponent(name)}`, undefined, {
      Cookie: `member_session=${memberCookieValue(name, zach.id, undefined, groupId)}`,
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  return { rank: body.rank, role: body.role, canString: body.canString, canGift: body.canGift };
}

describe("GET /api/members/me: the Profile card's rank, per club", () => {
  it('a player reads as a player, and no job fields are sent', async () => {
    expect(await rankAs('Zach', 'bpm')).toEqual({ rank: 'member', role: 'member', canString: undefined, canGift: undefined });
  });

  it('the same person can be an organiser in one club and a player in another', async () => {
    membershipOf('bpm', zach.id).role = 'owner';
    expect(await rankAs('Zach', 'bpm')).toMatchObject({ rank: 'owner', role: 'admin' });
    expect(await rankAs('Zachary', 'club-x')).toMatchObject({ rank: 'member', role: 'member' });
  });

  it('an admin reads as an admin', async () => {
    membershipOf('club-x', zach.id).role = 'admin';
    expect(await rankAs('Zachary', 'club-x')).toMatchObject({ rank: 'admin', role: 'admin' });
  });

  it('with groups off, the Member copy is the answer', async () => {
    delete process.env[MULTI];
    const res = await getMe(
      makeRequest('GET', 'http://x/api/members/me?name=Zach', undefined, {
        Cookie: `member_session=${memberCookieValue('Zach', zach.id)}`,
      }),
    );
    expect(await res.json()).toMatchObject({ rank: 'member' });
  });
});

describe('profileChip: what the card shows', () => {
  it('Organiser or Admin; a player shows nothing', () => {
    expect(profileChip('owner', true)).toBe('rankOwner');
    expect(profileChip('admin', true)).toBe('rankAdmin');
    expect(profileChip('member', false)).toBeNull();
  });

  it('unknown is not "player": the shell\'s admin verdict holds the chip', () => {
    expect(profileChip(null, true)).toBe('rankAdmin');
    expect(profileChip(null, false)).toBeNull();
  });

  it('a known rank wins over the shell verdict', () => {
    expect(profileChip('owner', true)).toBe('rankOwner');
  });

  it('readRank drops anything malformed to unknown', () => {
    expect(readRank('superuser')).toBeNull();
    expect(readRank(undefined)).toBeNull();
    expect(readRank('owner')).toBe('owner');
  });
});
