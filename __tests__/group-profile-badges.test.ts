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
import { profileChips, readBadges } from '@/components/ProfileTab';

/**
 * The Profile card's chips (roles v2, docs/plans/roles-v2.md): this club's
 * RANK — Organiser or Admin, a Player shows none — and the JOBS done here,
 * Stringer and Gifter. All three are the club's grant, read from the
 * membership, so the same person can wear different chips in two clubs.
 *
 * Zach is seeded the way BPM's stringers exist today: `Member.canString` and
 * no membership field, which BPM reads as yes (`canStringOf`) and another
 * club reads as no.
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

async function badgesAs(name: string, groupId: string) {
  const res = await getMe(
    makeRequest('GET', `http://x/api/members/me?name=${encodeURIComponent(name)}`, undefined, {
      Cookie: `member_session=${memberCookieValue(name, zach.id, undefined, groupId)}`,
    }),
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  return { rank: body.rank, canString: body.canString, canGift: body.canGift, role: body.role };
}

describe('GET /api/members/me: the Profile card\'s rank and jobs, per club', () => {
  it('BPM: a player who strings, read through the Member copy BPM still honours', async () => {
    // canGift is the MEMBERSHIP's with groups on; this row never set it.
    expect(await badgesAs('Zach', 'bpm')).toEqual({ rank: 'member', canString: true, canGift: false, role: 'member' });
  });

  it('another club: the same person holds nothing until that club grants it', async () => {
    expect(await badgesAs('Zachary', 'club-x')).toEqual({ rank: 'member', canString: false, canGift: false, role: 'member' });
    Object.assign(membershipOf('club-x', zach.id), { canString: true, canGift: true });
    expect(await badgesAs('Zachary', 'club-x')).toMatchObject({ canString: true, canGift: true });
  });

  it('an organiser reads as an organiser, while `role` stays collapsed to admin for older readers', async () => {
    membershipOf('bpm', zach.id).role = 'owner';
    expect(await badgesAs('Zach', 'bpm')).toMatchObject({ rank: 'owner', role: 'admin' });
  });

  it('with groups off, the Member copy is the answer', async () => {
    delete process.env[MULTI];
    const res = await getMe(
      makeRequest('GET', 'http://x/api/members/me?name=Zach', undefined, {
        Cookie: `member_session=${memberCookieValue('Zach', zach.id)}`,
      }),
    );
    expect(await res.json()).toMatchObject({ rank: 'member', canString: true, canGift: true });
  });
});

describe('profileChips: what the card shows', () => {
  it('rank first, then each job; a player with no job shows nothing', () => {
    expect(profileChips({ rank: 'owner', canString: true, canGift: true }, true)).toEqual(['rankOwner', 'stringer', 'gifter']);
    expect(profileChips({ rank: 'admin', canString: false, canGift: false }, true)).toEqual(['rankAdmin']);
    expect(profileChips({ rank: 'member', canString: true, canGift: false }, false)).toEqual(['stringer']);
    expect(profileChips({ rank: 'member', canString: false, canGift: false }, false)).toEqual([]);
  });

  it('unknown is not "none": the shell\'s admin verdict holds the rank, and no job is claimed', () => {
    expect(profileChips(null, true)).toEqual(['rankAdmin']);
    expect(profileChips(null, false)).toEqual([]);
    expect(profileChips(readBadges({}), true)).toEqual(['rankAdmin']);
  });

  it('a known rank wins over the shell verdict', () => {
    // An organiser is an admin to the shell; the card names the rank.
    expect(profileChips({ rank: 'owner', canString: null, canGift: null }, true)).toEqual(['rankOwner']);
  });

  it('readBadges drops anything malformed to unknown', () => {
    expect(readBadges({ rank: 'superuser', canString: 'yes', canGift: 1 })).toEqual({ rank: null, canString: null, canGift: null });
  });
});
