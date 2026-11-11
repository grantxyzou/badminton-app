import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  seedDoc,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedGroup,
  seedMembership,
  seedSession,
  seedPlayer,
  makeRequest,
  adminCookieValue,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { POINTER_ID, sessionIdFromDate } from '@/lib/cosmos';
import { groupDocId, groupScope } from '@/lib/groupScope';
import { resolveIdentity } from '@/lib/playerIdentity';
import { computeOwed } from '@/lib/owedBalance';
import { GET as unpaidGet } from '@/app/api/players/unpaid/route';
import { GET as levelGet } from '@/app/api/stats/level/route';
import { POST as jobPost } from '@/app/api/stringing/jobs/route';

/**
 * ONE NAME, TWO PEOPLE (audit, 2026-11-05). With groups on, an ACCOUNT name is
 * not what a club calls you: two accounts both called "Lin" can be in one club
 * only if the club calls the second one something else ("Lin W"). The rehearsal
 * found three ways that went wrong, each keyed on the account name:
 *
 *   1. Lin W asking about "Lin" read the OTHER Lin's balance — the gate
 *      compared her cookie's account name, "Lin", with the name asked about.
 *   2. Lin W asking about "Lin W", herself, was refused for the same reason.
 *   3. Her own identity matched the other Lin's rows by name, so "pay with
 *      credit" paid the other Lin's $77 out of Lin W's balance.
 */
const X = 'clubx';
const LIN = 'm-lin';
const LINW = 'm-linw';
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const PAST = '2026-08-27T19:00:00-07:00';
const NEXT = new Date(Date.now() + 7 * 86_400_000).toISOString();
const settledAt = '2026-08-28T00:00:00Z';

const cookieOf = (memberId: string) => `member_session=${memberCookieValue('Lin', memberId, 3600, X)}`;
const get = (url: string, cookie: string) => makeRequest('GET', url, undefined, { Cookie: cookie });

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
  // Both accounts are called "Lin"; the club calls the second "Lin W".
  seedMember('Lin', { id: LIN });
  seedMember('Lin', { id: LINW });
  seedGroup(X, { name: 'X Club', ownerMemberId: ADMIN_MEMBER_ID });
  seedMembership(X, ADMIN_MEMBER_ID, { name: 'Admin', role: 'owner' });
  seedMembership(X, LIN, { name: 'Lin' });
  seedMembership(X, LINW, { name: 'Lin W' });

  const pastId = sessionIdFromDate(PAST, X);
  const activeId = sessionIdFromDate(NEXT, X);
  seedSession(pastId, {
    groupId: X,
    datetime: PAST,
    deadline: PAST,
    costPerCourt: 89,
    courts: 1,
    settled: { at: settledAt, costPerPerson: 0, totalCost: 89, courtTotal: 89, birdTotal: 0, playerCount: 2, playerNames: ['Lin', 'Lin W'] },
  });
  seedSession(activeId, { groupId: X, datetime: NEXT, deadline: NEXT });
  seedDoc('sessions', { id: groupDocId(X, POINTER_ID), sessionId: groupDocId(X, POINTER_ID), groupId: X, activeSessionId: activeId });
  // Lin owes $77, Lin W owes $12 — a leak shows up as the wrong number.
  seedPlayer(pastId, 'Lin', { groupId: X, memberId: LIN, owedAmount: 77, settledAt });
  seedPlayer(pastId, 'Lin W', { groupId: X, memberId: LINW, owedAmount: 12, settledAt });
});
afterEach(() => {
  delete process.env[FLAG];
  delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
});

describe('the name gate is the club’s, by id', () => {
  it('Lin W cannot read the other Lin’s balance by asking for "Lin"', async () => {
    const res = await unpaidGet(get('http://x/api/players/unpaid?name=Lin', cookieOf(LINW)));
    expect(res.status).toBe(403);
  });

  it('Lin W reads her OWN balance under the name the club uses for her', async () => {
    const res = await unpaidGet(get('http://x/api/players/unpaid?name=Lin%20W', cookieOf(LINW)));
    expect(res.status).toBe(200);
    expect((await res.json()).totalOwed).toBe(12);
  });

  it('the first Lin still reads hers (the vacuity guard)', async () => {
    const res = await unpaidGet(get('http://x/api/players/unpaid?name=Lin', cookieOf(LIN)));
    expect(res.status).toBe(200);
    expect((await res.json()).totalOwed).toBe(77);
  });

  it('every gate behind ownsNameOrAdmin answers the same way (stats/level)', async () => {
    expect((await levelGet(get('http://x/api/stats/level?name=Lin', cookieOf(LINW)))).status).toBe(403);
    expect((await levelGet(get('http://x/api/stats/level?name=Lin%20W', cookieOf(LINW)))).status).not.toBe(403);
  });
});

describe('a person’s lines are theirs by id', () => {
  it('Lin W’s identity owes $12, never the other Lin’s $77 (what credit and self-report pay)', async () => {
    const scope = groupScope(X);
    const owed = await computeOwed(scope, await resolveIdentity({ memberId: LINW }, X));
    expect(owed.sessions.map((s) => s.owedAmount)).toEqual([12]);
  });

  it('a name looked up by an admin resolves inside the club', async () => {
    const identity = await resolveIdentity({ name: 'Lin W' }, X);
    expect(identity.memberId).toBe(LINW);
  });
});

describe('a stringing job is billed only to someone on this club’s roster', () => {
  it('refuses a member id from outside the club', async () => {
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    seedMember('Outsider', { id: 'm-out' });
    const body = { memberId: 'm-out', memberName: 'Outsider', racketLabel: 'Astrox', stringLabel: 'BG80', tensionMains: 24, tensionCrosses: 24 };
    const admin = `admin_session=${adminCookieValue({ groupId: X })}`;
    const res = await jobPost(makeRequest('POST', 'http://x/api/stringing/jobs', body, { Cookie: admin }));
    expect(res.status).toBe(404);
    const ok = await jobPost(makeRequest('POST', 'http://x/api/stringing/jobs', { ...body, memberId: LINW, memberName: 'Lin W' }, { Cookie: admin }));
    expect(ok.status).toBe(201);
  });
});
