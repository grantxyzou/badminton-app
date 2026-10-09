import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  getStore,
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
import { groupDocId } from '@/lib/groupScope';
import { CLUB_GEAR_MIN_COHORT } from '@/lib/clubGear';
import { GET as sessionsGet } from '@/app/api/sessions/route';
import { GET as recentGet } from '@/app/api/sessions/recent/route';
import { GET as locationsGet } from '@/app/api/sessions/locations/route';
import { GET as costsGet } from '@/app/api/sessions/costs/route';
import { GET as historyGet } from '@/app/api/sessions/history/route';
import { GET as attendanceGet } from '@/app/api/stats/attendance/route';
import { GET as partnersGet } from '@/app/api/stats/partners/route';
import { GET as tensionGet } from '@/app/api/stats/club/tension/route';
import { GET as eligibleGet } from '@/app/api/kudos/eligible/route';
import { GET as creditGet } from '@/app/api/credit/route';
import { GET as paymentsGet } from '@/app/api/admin/payments/route';
import { GET as unpaidGet } from '@/app/api/players/unpaid/route';
import { GET as memberHistoryGet } from '@/app/api/members/[id]/history/route';
import { GET as currentGroupGet } from '@/app/api/groups/current/route';

/**
 * THE SWEEP, BATCH 2: fourteen READ routes that act inside a group and had no
 * two-club test (`UNSWEPT` in group-sweep-coverage.test.ts).
 *
 * Same shape as group-isolation-routes.test.ts: two clubs, neither of them BPM
 * (BPM is the tolerated default, so a sweep that used it could pass on the
 * fallback rather than on the claim), and every case runs the route under BOTH
 * clubs' cookies and asserts both directions — the club sees its OWN rows (the
 * vacuity guard: a route answering nothing passes every "not theirs" check)
 * and none of the other club's.
 *
 * ONE PERSON, BOTH CLUBS. "Ana" is a single Member (`m-ana`) on both rosters
 * under the same roster name, with rows in both. That is the ordinary
 * one-account-many-groups case, and it is the sharp one: her memberId and her
 * name match rows in BOTH clubs, so a route keyed on either that forgot the
 * group would still find the other club's rows. Only the group can separate
 * them. Her co-players differ per club (`Alphamate` / `Betamate`) and so do
 * the clubs' numbers, so a leak shows up as a value, not just a count.
 */
const A = 'club-a';
const B = 'club-b';
const ANA = 'm-ana';
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const FLAGS_ON = ['NEXT_PUBLIC_FLAG_STORE_CREDIT', 'NEXT_PUBLIC_FLAG_PAYMENTS_AUTO'] as const;

const PAST = '2026-08-27T19:00:00-07:00';
const NEXT = new Date(Date.now() + 7 * 86_400_000).toISOString();

interface Club {
  id: string;
  marker: string;
  pastId: string;
  activeId: string;
  costPerCourt: number;
  owed: number;
}

/** An admin cookie for one club, plus the owner membership that admits it. */
function adminIn(groupId: string): string {
  seedMembership(groupId, ADMIN_MEMBER_ID, { name: `Admin ${groupId}`, role: 'owner' });
  return `admin_session=${adminCookieValue({ groupId })}`;
}
const anaIn = (groupId: string) => `member_session=${memberCookieValue('Ana', ANA, 3600, groupId)}`;

const get = (url: string, cookie: string) => makeRequest('GET', url, undefined, { Cookie: cookie });

/**
 * A club with a settled PAST session (Ana and her club's mate on it, Ana
 * owing), a future ACTIVE session behind the club's own pointer, and Ana on its
 * roster. `n` separates the clubs' numbers.
 */
function seedClub(groupId: string, marker: string, n: number): Club {
  const pastId = sessionIdFromDate(PAST, groupId);
  const activeId = sessionIdFromDate(NEXT, groupId);
  const costPerCourt = 30 + n;
  const owed = 10 + n;
  seedGroup(groupId, { name: `${marker} Club`, ownerMemberId: ADMIN_MEMBER_ID });
  seedMembership(groupId, ANA, { name: 'Ana' });
  seedMembership(groupId, `m-${marker.toLowerCase()}mate`, { name: `${marker}mate` });

  seedSession(pastId, {
    groupId,
    datetime: PAST,
    deadline: PAST,
    title: `${marker} past`,
    locationName: `${marker} Gym`,
    locationAddress: `${n} ${marker} St`,
    costPerCourt,
    courts: 2,
    settled: {
      at: '2026-08-28T00:00:00Z',
      costPerPerson: owed,
      totalCost: costPerCourt * 2,
      courtTotal: costPerCourt * 2,
      birdTotal: 0,
      playerCount: 2,
      playerNames: ['Ana', `${marker}mate`],
    },
  });
  seedSession(activeId, { groupId, datetime: NEXT, deadline: NEXT, title: `${marker} next`, costPerCourt, courts: 2 });
  seedDoc('sessions', {
    id: groupDocId(groupId, POINTER_ID),
    sessionId: groupDocId(groupId, POINTER_ID),
    groupId,
    activeSessionId: activeId,
  });

  seedPlayer(pastId, 'Ana', { groupId, memberId: ANA, owedAmount: owed, settledAt: '2026-08-28T00:00:00Z' });
  seedPlayer(pastId, `${marker}mate`, { groupId, memberId: `m-${marker.toLowerCase()}mate`, paid: true, owedAmount: owed });
  seedPlayer(activeId, `${marker}mate`, { groupId });
  return { id: groupId, marker, pastId, activeId, costPerCourt, owed };
}

let a: Club;
let b: Club;

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  // No BPM membership: every admin here is an admin of club A or club B only.
  await seedTestAdminMember({ membership: false });
  seedMember('Ana', { id: ANA });
  process.env[FLAG] = 'true';
  for (const f of FLAGS_ON) process.env[f] = 'true';
  a = seedClub(A, 'Alpha', 1);
  b = seedClub(B, 'Beta', 7);
});
afterEach(() => {
  delete process.env[FLAG];
  for (const f of FLAGS_ON) delete process.env[f];
});

/** Run `check` as each club against the other: A vs B, then B vs A. */
async function bothWays(check: (mine: Club, theirs: Club) => Promise<void>) {
  await check(a, b);
  await check(b, a);
}

describe('admin session lists are the claimed club’s', () => {
  it('GET /api/sessions', async () => {
    await bothWays(async (mine, theirs) => {
      const res = await sessionsGet(get('http://x/api/sessions', adminIn(mine.id)));
      expect(res.status).toBe(200);
      const ids = ((await res.json()) as Array<{ id: string }>).map((s) => s.id).sort();
      expect(ids).toEqual([mine.pastId, mine.activeId].sort());
      expect(ids).not.toContain(theirs.pastId);
    });
  });

  it('GET /api/sessions/recent', async () => {
    await bothWays(async (mine, theirs) => {
      const res = await recentGet(get('http://x/api/sessions/recent', adminIn(mine.id)));
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Array<{ sessionId: string; attendanceCount: number }>;
      expect(rows.map((r) => r.sessionId).sort()).toEqual([mine.pastId, mine.activeId].sort());
      expect(JSON.stringify(rows)).not.toContain(theirs.id);
      // Each summary counts only its own club's roster.
      expect(rows.find((r) => r.sessionId === mine.pastId)?.attendanceCount).toBe(2);
    });
  });

  it('GET /api/sessions/locations', async () => {
    await bothWays(async (mine, theirs) => {
      const res = await locationsGet(get('http://x/api/sessions/locations', adminIn(mine.id)));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { locations: Array<{ locationName: string }>; titles: string[] };
      expect(body.locations.map((l) => l.locationName)).toEqual([`${mine.marker} Gym`]);
      expect(body.titles.sort()).toEqual([`${mine.marker} next`, `${mine.marker} past`]);
      expect(JSON.stringify(body)).not.toContain(theirs.marker);
    });
  });

  it('GET /api/sessions/costs', async () => {
    await bothWays(async (mine) => {
      const res = await costsGet(get('http://x/api/sessions/costs', adminIn(mine.id)));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ costs: [mine.costPerCourt] });
    });
  });

  it('GET /api/sessions/history (past sessions only, with receipts)', async () => {
    await bothWays(async (mine, theirs) => {
      const res = await historyGet(get('http://x/api/sessions/history', adminIn(mine.id)));
      expect(res.status).toBe(200);
      const { sessions } = (await res.json()) as { sessions: Array<{ sessionId: string; costPerPerson: number; attendanceCount: number }> };
      // The club's active session is excluded by ITS OWN pointer; the other
      // club's past session must not appear just because it is not active here.
      expect(sessions.map((s) => s.sessionId)).toEqual([mine.pastId]);
      expect(sessions[0].costPerPerson).toBe(mine.owed);
      expect(sessions[0].attendanceCount).toBe(2);
      expect(JSON.stringify(sessions)).not.toContain(theirs.id);
    });
  });

  it('GET /api/admin/payments — the inbox is the claimed club’s', async () => {
    for (const club of [a, b]) {
      seedDoc('payments', {
        id: `etx:${club.id}`,
        groupId: club.id,
        source: 'etransfer',
        senderName: `${club.marker} Sender`,
        amountCents: 1234,
        memo: null,
        subject: 's',
        receivedAt: new Date().toISOString(),
        authenticated: true,
        status: 'review',
        reason: 'no_candidate',
        allocations: [],
        createdAt: new Date().toISOString(),
      });
    }
    await bothWays(async (mine, theirs) => {
      const res = await paymentsGet(get('http://x/api/admin/payments', adminIn(mine.id)));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { review: Array<{ senderName: string }>; last28Days: { received: number } };
      expect(body.review.map((p) => p.senderName)).toEqual([`${mine.marker} Sender`]);
      expect(body.last28Days.received).toBe(1);
      expect(JSON.stringify(body)).not.toContain(`${theirs.marker} Sender`);
    });
  });

  it('GET /api/members/[id]/history — one person, only this club’s rows', async () => {
    await bothWays(async (mine, theirs) => {
      const res = await memberHistoryGet(get(`http://x/api/members/${ANA}/history`, adminIn(mine.id)), {
        params: Promise.resolve({ id: ANA }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sessions: Array<{ sessionId: string; costPerPerson: number }> };
      expect(body.sessions.map((s) => s.sessionId)).toEqual([mine.pastId]);
      expect(body.sessions[0].costPerPerson).toBe(mine.owed);
      expect(JSON.stringify(body)).not.toContain(theirs.id);
    });
  });
});

describe('a member’s own reads are the claimed club’s', () => {
  it('GET /api/stats/attendance', async () => {
    await bothWays(async (mine, theirs) => {
      const res = await attendanceGet(get('http://x/api/stats/attendance?name=Ana', anaIn(mine.id)));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { attended: number; history: Array<{ sessionId: string }> };
      // The future active session is not "played"; only the club's past one is.
      expect(body.history.map((h) => h.sessionId)).toEqual([mine.pastId]);
      expect(body.attended).toBe(1);
      expect(JSON.stringify(body)).not.toContain(theirs.id);
    });
  });

  it('GET /api/stats/partners', async () => {
    await bothWays(async (mine, theirs) => {
      const res = await partnersGet(get('http://x/api/stats/partners?name=Ana&weeks=260', anaIn(mine.id)));
      expect(res.status).toBe(200);
      const { partners } = (await res.json()) as { partners: Array<{ name: string; count: number }> };
      expect(partners).toEqual([{ name: `${mine.marker}mate`, count: 1 }]);
      expect(JSON.stringify(partners)).not.toContain(theirs.marker);
    });
  });

  it('GET /api/kudos/eligible', async () => {
    await bothWays(async (mine, theirs) => {
      const res = await eligibleGet(get('http://x/api/kudos/eligible', anaIn(mine.id)));
      expect(res.status).toBe(200);
      const { names } = (await res.json()) as { names: string[] };
      expect(names).toEqual([`${mine.marker}mate`]);
      expect(names).not.toContain(`${theirs.marker}mate`);
    });
  });

  it('GET /api/players/unpaid — what Ana owes HERE', async () => {
    await bothWays(async (mine, theirs) => {
      const res = await unpaidGet(get('http://x/api/players/unpaid?name=Ana', anaIn(mine.id)));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { totalOwed: number; sessions: Array<{ sessionId: string }> };
      expect(body.sessions.map((s) => s.sessionId)).toEqual([mine.pastId]);
      expect(body.totalOwed).toBe(mine.owed);
      expect(JSON.stringify(body)).not.toContain(theirs.id);
    });
  });

  it('GET /api/credit — the same person’s credit is per club', async () => {
    const entry = (club: Club, cents: number) => ({
      id: `grant:${club.id}`,
      groupId: club.id,
      memberId: ANA,
      account: 'member_credit',
      kind: 'grant',
      amountCents: cents,
      note: `${club.marker} credit`,
      createdAt: '2026-09-01T00:00:00Z',
      createdBy: ADMIN_MEMBER_ID,
    });
    seedDoc('ledger', entry(a, 500));
    seedDoc('ledger', entry(b, 900));
    const balances: Record<string, number> = { [A]: 500, [B]: 900 };
    await bothWays(async (mine, theirs) => {
      const res = await creditGet(get('http://x/api/credit', anaIn(mine.id)));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { balanceCents: number; entries: Array<{ note: string }> };
      expect(body.balanceCents).toBe(balances[mine.id]);
      expect(body.entries.map((e) => e.note)).toEqual([`${mine.marker} credit`]);
      expect(JSON.stringify(body)).not.toContain(`${theirs.marker} credit`);
    });
  });

  it('GET /api/groups/current', async () => {
    // A third person on A's roster only, so the two clubs' counts differ. The
    // owner membership is part of each roster: Ana, the mate, the owner (+ Extra).
    seedMembership(A, 'm-extra', { name: 'Extra' });
    for (const club of [A, B]) seedMembership(club, ADMIN_MEMBER_ID, { name: `Admin ${club}`, role: 'owner' });
    const counts: Record<string, number> = { [A]: 4, [B]: 3 };
    await bothWays(async (mine, theirs) => {
      const res = await currentGroupGet(get('http://x/api/groups/current', anaIn(mine.id)));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; name: string; memberCount: number; isOwner: boolean };
      expect(body.id).toBe(mine.id);
      expect(body.name).toBe(`${mine.marker} Club`);
      expect(body.memberCount).toBe(counts[mine.id]);
      expect(body.isOwner).toBe(false);
      expect(JSON.stringify(body)).not.toContain(theirs.marker);
    });
  });

  it('GET /api/stats/club/tension — the band is built from this club’s roster only', async () => {
    const FRAME = 'astrox-99';
    // A full cohort per side, at clearly separated tensions, so each club has
    // a band of its own and a leak would move both its size and its range.
    const cohort = (club: Club, tensions: number[]) =>
      tensions.forEach((lbs, i) => {
        const id = `m-${club.id}-${i}`;
        seedMember(`${club.marker}${i}`, { id });
        seedMembership(club.id, id, { name: `${club.marker}${i}` });
        seedDoc('playerGear', {
          id: `gear-${id}`,
          memberId: id,
          items: [
            { id: `r-${id}`, category: 'racket', catalogId: FRAME, label: 'Astrox 99' },
            { id: `s-${id}`, category: 'string', label: 'BG80', tensionLbs: lbs },
          ],
        });
      });
    expect(CLUB_GEAR_MIN_COHORT).toBe(3);
    cohort(a, [24, 25, 26]);
    cohort(b, [30, 31, 32]);
    const want: Record<string, { sampleSize: number; low: number; high: number }> = {
      [A]: { sampleSize: 3, low: 24, high: 26 },
      [B]: { sampleSize: 3, low: 30, high: 32 },
    };
    await bothWays(async (mine) => {
      const res = await tensionGet(get(`http://x/api/stats/club/tension?frame=${FRAME}`, anaIn(mine.id)));
      expect(res.status).toBe(200);
      const { band } = (await res.json()) as { band: { sampleSize: number; low: number; high: number } | null };
      expect(band).toMatchObject(want[mine.id]);
    });
  });
});

describe('the fixture is what it claims', () => {
  it('Ana is one person on both rosters, with rows in both clubs', () => {
    const memberships = (getStore()['memberships'] ?? []) as Array<{ groupId: string; memberId: string; kind?: string }>;
    expect(memberships.filter((m) => m.memberId === ANA && !m.kind).map((m) => m.groupId).sort()).toEqual([A, B]);
    const rows = (getStore()['players'] ?? []) as Array<{ memberId?: string; groupId?: string }>;
    expect(rows.filter((p) => p.memberId === ANA).map((p) => p.groupId).sort()).toEqual([A, B]);
  });
});
