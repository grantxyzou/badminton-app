import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  seedDoc,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedGroup,
  seedMembership,
  makeRequest,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { GET as bandsGet } from '@/app/api/stats/club/bands/route';
import { GET as gearGet } from '@/app/api/stats/club/gear/route';
import { rosterMemberIds, rosterMembers } from '@/lib/roster';

/**
 * PHASE 2'S GATE: the club AGGREGATES over PERSON containers.
 *
 * Phase 1b's gate covers the GROUP containers, where a `groupId` on the row is
 * what keeps clubs apart. These are the other half, and they cannot work that
 * way: `assessments` and `playerGear` belong to a PERSON, who may be in two
 * clubs, so the row can carry no single group. The only thing that can narrow
 * them is the ROSTER — hence `rosterMemberIds()`, and hence this file.
 *
 * Each case seeds a stranger — a Member with data, on ANOTHER club's roster and
 * not on BPM's — and asserts BPM's aggregate cannot see them. Before the
 * narrowing every one of these scanned the whole container, so a stranger's
 * self-assessment moved BPM's bands and a stranger's bag appeared in BPM's
 * "what the club plays".
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
let ip = 0;
const asMember = (name: string, memberId: string) => ({
  'X-Client-IP': `10.7.0.${++ip}`,
  Cookie: `member_session=${memberCookieValue(name, memberId, 3600, 'bpm')}`,
});

/**
 * A person with a self-assessment and a bag, on `groupId`'s roster only.
 * `racket` names the catalog item so a cohort can be built: `tallyClubGear`
 * publishes nothing an entry below `CLUB_GEAR_MIN_COHORT` people share, which
 * is the anonymity floor — so an isolation case needs THREE of each side, not
 * one, or both answers are an empty list and the test proves nothing.
 */
function seedPlayerWithData(groupId: string, name: string, overall: number, racket = `racket-${name.toLowerCase()}`) {
  const m = seedMember(name);
  seedMembership(groupId, m.id, { name });
  seedDoc('assessments', {
    id: `a-${m.id}`,
    memberId: m.id,
    name,
    takenAt: '2026-09-01T00:00:00.000Z',
    overall,
    ratings: [{ dimension: 'clears', value: overall }],
  });
  seedDoc('playerGear', {
    id: `gear-${m.id}`,
    memberId: m.id,
    // `tallyClubGear` keys on LABEL, not catalogId — a bag records what the
    // player calls the thing.
    items: [{ category: 'racket', label: racket }],
  });
  return m;
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  seedGroup('bpm');
  seedGroup('other');
  process.env[FLAG] = 'true';
});
afterEach(() => {
  delete process.env[FLAG];
});

describe('the roster is what a club aggregate may see', () => {
  it('rosterMemberIds is the group, not the deployment', async () => {
    const mine = seedPlayerWithData('bpm', 'Lin', 6);
    const stranger = seedPlayerWithData('other', 'Viktor', 9);
    const ids = await rosterMemberIds('bpm');
    expect(ids.has(mine.id)).toBe(true);
    expect(ids.has(stranger.id)).toBe(false);
    // The admin is seeded onto BPM's roster with the member, so an admin-only
    // route under the flag is not locked out of its own club.
    expect(ids.has(ADMIN_MEMBER_ID)).toBe(true);
  });

  it('a name means something only inside a group — the roster overlays THIS club’s name', async () => {
    const m = seedMember('Lin');
    seedMembership('bpm', m.id, { name: 'Captain' });
    const entries = await rosterMembers('bpm');
    const row = entries.find((e) => e.member.id === m.id);
    // `Member.name` is the person's default display name; the club calls them
    // something else, and the roster reads the way the club knows its people.
    expect(row?.membership?.name).toBe('Captain');
  });

  it('club bands ignore a stranger’s self-assessment', async () => {
    const mine = seedPlayerWithData('bpm', 'Lin', 6);
    seedPlayerWithData('other', 'Viktor', 9);
    const res = await bandsGet(makeRequest('GET', 'http://x/api/stats/club/bands?name=Lin', undefined, asMember('Lin', mine.id)));
    expect(res.status).toBe(200);
    const body = await res.json();
    // One person on the roster has an assessment, so there is nobody to
    // compare against. Before the narrowing the stranger WAS the cohort.
    expect(body.cohort ?? 0).toBe(0);
  });

  it('club gear counts only the roster’s bags', async () => {
    const mine = seedPlayerWithData('bpm', 'Lin', 6, 'racket-ours');
    seedPlayerWithData('bpm', 'Carolina', 6, 'racket-ours');
    seedPlayerWithData('bpm', 'Akane', 6, 'racket-ours');
    for (const n of ['Viktor', 'Kento', 'Sindhu']) seedPlayerWithData('other', n, 9, 'racket-theirs');
    const res = await gearGet(makeRequest('GET', 'http://x/api/stats/club/gear', undefined, asMember('Lin', mine.id)));
    expect(res.status).toBe(200);
    const names = JSON.stringify((await res.json()).entries ?? []);
    expect(names).toContain('racket-ours');
    expect(names).not.toContain('racket-theirs');
  });
});

describe('flag off, the aggregates are exactly what they were', () => {
  beforeEach(() => {
    delete process.env[FLAG];
  });

  it('counts everyone, because one deployment was one club', async () => {
    // The narrowing is deliberately flag-gated. Flag off, `rosterMemberIds`
    // would answer "every ACTIVE member" — very nearly the same set, but a
    // soft-deleted member's data counts toward the club TODAY, and dropping it
    // is a correction that rides in with the cutover rather than ahead of it.
    const mine = seedPlayerWithData('bpm', 'Lin', 6, 'racket-ours');
    for (const n of ['Viktor', 'Kento', 'Sindhu']) seedPlayerWithData('other', n, 9, 'racket-theirs');
    const res = await gearGet(makeRequest('GET', 'http://x/api/stats/club/gear', undefined, asMember('Lin', mine.id)));
    const names = JSON.stringify((await res.json()).entries ?? []);
    expect(names).toContain('racket-theirs');
  });
});
