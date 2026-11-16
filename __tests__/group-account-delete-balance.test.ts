import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DELETE } from '@/app/api/members/me/route';
import { outstandingBalanceFor } from '@/lib/outstandingBalance';
import { POINTER_ID, sessionIdFromDate } from '@/lib/cosmos';
import { groupDocId } from '@/lib/groupScope';
import {
  resetMockStore,
  getStore,
  seedSession,
  seedPlayer,
  seedMember,
  seedMembership,
  seedGroup,
  seedDoc,
  makeRequest,
  memberCookieValue,
  setupAdminPin,
  seedTestAdminMember,
  ADMIN_MEMBER_ID,
} from './helpers';

/**
 * NO ACCOUNT DELETION WHILE A BALANCE IS OUTSTANDING (docs/plans/money-audit.md,
 * gap 4; Grant, 2026-11-16). The purge deletes the person's stringing jobs and
 * anonymizes their rows, so a debt on either became a line nobody could be
 * asked for. `DELETE /api/members/me` reads what they owe in every club they
 * are active in — the figure Home shows them — and refuses with the cents and
 * the clubs until it is zero.
 */

const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const LIN = 'm-lin';
const NEXT = new Date(Date.now() + 7 * 86_400_000).toISOString();
const PAST = '2026-08-27T19:00:00-07:00';
const settled = (at: string) => ({ at, costPerPerson: 12, totalCost: 48, courtTotal: 48, birdTotal: 0, playerCount: 4, playerNames: [] });

function club(groupId: string) {
  const activeId = sessionIdFromDate(NEXT, groupId);
  const pastId = sessionIdFromDate(PAST, groupId);
  seedSession(activeId, { groupId, datetime: NEXT, deadline: NEXT });
  seedSession(pastId, { groupId, datetime: PAST, deadline: PAST, settled: settled('2026-08-28T00:00:00Z') });
  seedDoc('sessions', { id: groupDocId(groupId, POINTER_ID), sessionId: groupDocId(groupId, POINTER_ID), groupId, activeSessionId: activeId });
  return { activeId, pastId };
}

let x: ReturnType<typeof club>;
let y: ReturnType<typeof club>;

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  seedMember('Lin', { id: LIN });
  seedGroup('clubx', { ownerMemberId: ADMIN_MEMBER_ID, name: 'Club X' });
  seedGroup('cluby', { ownerMemberId: ADMIN_MEMBER_ID, name: 'Club Y' });
  seedMembership('clubx', ADMIN_MEMBER_ID, { name: 'Admin', role: 'owner' });
  seedMembership('cluby', ADMIN_MEMBER_ID, { name: 'Admin', role: 'owner' });
  seedMembership('clubx', LIN, { name: 'Lin' });
  seedMembership('cluby', LIN, { name: 'Lin' });
  x = club('clubx');
  y = club('cluby');
});

afterEach(() => {
  delete process.env[FLAG];
  delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
});

const deleteLin = () =>
  DELETE(makeRequest('DELETE', 'http://x/api/members/me', { confirm: true }, { Cookie: `member_session=${memberCookieValue('Lin', LIN, undefined, 'clubx')}` }));
const members = () => getStore()['members'] as Array<{ id: string }>;

describe('what stands in the way', () => {
  it('a settled, unpaid session line in ANY of their clubs — the refusal names the club and the cents, and nothing is touched', async () => {
    // Owes in club Y, the club the request did NOT come from.
    seedPlayer(y.pastId, 'Lin', { groupId: 'cluby', memberId: LIN, owedAmount: 12, settledAt: '2026-08-28T00:00:00Z' });
    const res = await deleteLin();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'balance_outstanding', cents: 1200, clubs: [{ groupId: 'cluby', name: 'Club Y', cents: 1200 }] });
    expect(members().some((m) => m.id === LIN)).toBe(true);
  });

  it('a finished, priced, unpaid stringing job', async () => {
    seedDoc('stringingJobs', {
      id: 'job-1', groupId: 'clubx', memberId: LIN, memberName: 'Lin', jobNo: 'J-0001', racketLabel: 'Astrox', stringLabel: 'BG65',
      status: 'ready', priceCents: 2800, paidAt: null, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', history: [],
    });
    const res = await deleteLin();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ cents: 2800, clubs: [{ groupId: 'clubx', name: 'Club X', cents: 2800 }] });
  });

  it('the live estimate for a played, not-yet-settled session counts too: it is a debt the moment the bill freezes', async () => {
    seedSession(sessionIdFromDate('2026-10-01T19:00:00-07:00', 'clubx'), { groupId: 'clubx', datetime: '2026-10-01T19:00:00-07:00', costPerCourt: 24, courts: 1 });
    seedPlayer(sessionIdFromDate('2026-10-01T19:00:00-07:00', 'clubx'), 'Lin', { groupId: 'clubx', memberId: LIN });
    seedPlayer(sessionIdFromDate('2026-10-01T19:00:00-07:00', 'clubx'), 'Admin', { groupId: 'clubx', memberId: ADMIN_MEMBER_ID });
    const owed = await outstandingBalanceFor(LIN);
    expect(owed.clubs.map((c) => [c.groupId, c.cents])).toEqual([['clubx', 1200]]);
    expect((await deleteLin()).status).toBe(409);
  });
});

describe('what does not', () => {
  it('a paid line, a covered line, and a job already paid: the account goes', async () => {
    seedPlayer(x.pastId, 'Lin', { groupId: 'clubx', memberId: LIN, owedAmount: 12, settledAt: '2026-08-28T00:00:00Z', paid: true, paidAt: '2026-08-29T00:00:00Z', paidVia: 'manual' });
    seedPlayer(y.pastId, 'Lin', { groupId: 'cluby', memberId: LIN, owedAmount: 12, settledAt: '2026-08-28T00:00:00Z', writtenOff: true, coverMode: 'absorb' });
    seedDoc('stringingJobs', {
      id: 'job-2', groupId: 'clubx', memberId: LIN, memberName: 'Lin', jobNo: 'J-0002', racketLabel: 'Astrox', stringLabel: 'BG65',
      status: 'picked_up', priceCents: 2800, paidAt: '2026-10-03T00:00:00Z', paidVia: 'etransfer', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z', history: [],
    });
    expect(await outstandingBalanceFor(LIN)).toEqual({ cents: 0, clubs: [] });
    expect((await deleteLin()).status).toBe(200);
    expect(members().some((m) => m.id === LIN)).toBe(false);
  });

  it('a club they were removed from is not counted', async () => {
    seedPlayer(y.pastId, 'Lin', { groupId: 'cluby', memberId: LIN, owedAmount: 12, settledAt: '2026-08-28T00:00:00Z' });
    const ms = (getStore()['memberships'] as Array<{ groupId: string; memberId: string; status: string }>).find((m) => m.groupId === 'cluby' && m.memberId === LIN)!;
    ms.status = 'removed';
    expect((await outstandingBalanceFor(LIN)).clubs).toEqual([]);
  });
});
