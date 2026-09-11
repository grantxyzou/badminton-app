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
  makeRequest,
  adminCookieValue,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { sessionIdFromDate } from '@/lib/cosmos';
import { groupDocId } from '@/lib/groupScope';
import { GET as gamesGet } from '@/app/api/games/route';
import { GET as anomaliesGet } from '@/app/api/admin/anomalies/route';
import { GET as owedAuditGet } from '@/app/api/admin/owed-audit/route';
import { GET as slice0Get } from '@/app/api/admin/slice0/route';

/**
 * THE LAST FOUR UNCOVERED SURFACES: games, anomalies, owed-audit and slice0.
 *
 * Phase 1b's gate covers the GROUP containers and Phase 2's covers the club
 * aggregates over PERSON containers. These four are what was left, and they are
 * the ADMIN reads — the ones that total money, count engagement and say who
 * needs chasing. A leak here is worse than one on a roster: nobody reads a
 * roster and acts on it, and an admin reads these to decide who to bill.
 *
 * EVERY PERSON IN THIS FILE IS CALLED "ANA", IN BOTH CLUBS. That is the sharp
 * version of the test, not a shortcut. Three of these four routes join on NAME
 * rather than on memberId — `gameResults` stores names by design, owed-audit
 * takes `?name=`, and slice0's roster key falls back to a name for rows that
 * predate the memberId migration. A fixture using distinct names would pass
 * while a name-keyed read that ignored the group still leaked, because the
 * names would not have collided. Roster names are unique per CLUB and
 * deliberately not globally, so two Anas is the ordinary case, not a corner.
 *
 * Each case asserts BOTH directions: the club sees its own row (the vacuity
 * guard) and not the other's. Without the first half, a route returning nothing
 * at all would pass every isolation assertion here.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const POINTER_ID = 'active-session-pointer';
const DATE = '2026-09-03T19:00:00-07:00';
let ip = 0;

const asAdminOf = (groupId: string) => ({
  'X-Client-IP': `10.11.0.${++ip}`,
  Cookie: `admin_session=${adminCookieValue({ groupId })}`,
});
const asMemberOf = (name: string, memberId: string, groupId: string) => ({
  'X-Client-IP': `10.11.1.${++ip}`,
  Cookie: `member_session=${memberCookieValue(name, memberId, 3600, groupId)}`,
});

/**
 * A club with a session, a pointer, an Ana on its roster, a game she played, an
 * unpaid line in her name and a racket she saved. `marker` is what distinguishes
 * the two clubs' DATA while the names stay identical.
 */
function seedClub(groupId: string, marker: number) {
  const sessionId = sessionIdFromDate(DATE, groupId);
  seedGroup(groupId, { ownerMemberId: ADMIN_MEMBER_ID, name: `Club ${marker}` });
  seedMembership(groupId, ADMIN_MEMBER_ID, { name: 'Test Admin', role: 'owner' });
  seedSession(sessionId, { groupId, sessionId, datetime: DATE, deadline: DATE, courts: marker, maxPlayers: 12 });
  seedDoc('sessions', {
    id: groupDocId(groupId, POINTER_ID),
    sessionId: groupDocId(groupId, POINTER_ID),
    groupId,
    activeSessionId: sessionId,
  });

  const ana = seedMember('Ana');
  seedMembership(groupId, ana.id, { name: 'Ana' });

  seedDoc('gameResults', {
    id: `game-${groupId}`,
    groupId,
    sessionId,
    teamA: ['Ana'],
    teamB: ['Partner'],
    scoreA: marker,
    scoreB: 0,
    loggedAt: '2026-09-03T21:00:00-07:00',
  });
  seedDoc('players', {
    id: `player-${groupId}`,
    groupId,
    sessionId,
    name: 'Ana',
    memberId: ana.id,
    paid: false,
    owedAmount: marker,
    settledAt: '2026-09-03T22:00:00-07:00',
  });
  seedDoc('playerGear', {
    id: `gear-${ana.id}`,
    memberId: ana.id,
    name: 'Ana',
    items: [{ category: 'racket', label: `Club ${marker} racket` }],
  });
  seedDoc('assessments', {
    id: `assess-${ana.id}`,
    memberId: ana.id,
    name: 'Ana',
    takenAt: '2026-09-02T00:00:00-07:00',
    ratings: { clears: marker },
  });
  return { sessionId, ana };
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env[FLAG] = 'true';
  process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
  await seedTestAdminMember();
});

afterEach(() => {
  delete process.env[FLAG];
  delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
});

describe('GET /api/games — a name-keyed read', () => {
  it("gives Ana her club's games and never the other Ana's", async () => {
    const one = seedClub('alpha', 1);
    seedClub('beta', 2);

    const body = await (await gamesGet(
      makeRequest(
        'GET',
        'http://localhost:3000/api/games?name=Ana&all=true',
        undefined,
        asMemberOf('Ana', one.ana.id, 'alpha'),
      ),
    )).json();

    const games = (body.games ?? []) as Array<{ id?: string }>;
    // Vacuity guard first: an empty list would satisfy the next line for free.
    expect(games.map((g) => g.id)).toEqual(['game-alpha']);
  });
});

describe('GET /api/admin/anomalies', () => {
  it('reads the claimed club\'s session, not the other club\'s', async () => {
    seedClub('alpha', 1);
    seedClub('beta', 2);

    // Give ALPHA alone a real settings drift: its session says 12 players, its
    // snapshot of last week says 20. Beta's session has no snapshot and so has
    // nothing to drift from.
    const store = getStore()['sessions'] as Array<Record<string, unknown>>;
    const alphaSession = store.find((d) => d.id === sessionIdFromDate(DATE, 'alpha'))!;
    alphaSession.prevSnapshot = {
      courtCount: 2,
      costPerCourt: 40,
      maxPlayers: 20,
      deadlineOffsetHours: 7,
      signupOpensOffsetHours: 0,
    };

    const alpha = await anomaliesGet(makeRequest('GET', 'http://localhost:3000/api/admin/anomalies', undefined, asAdminOf('alpha')));
    const beta = await anomaliesGet(makeRequest('GET', 'http://localhost:3000/api/admin/anomalies', undefined, asAdminOf('beta')));
    expect(alpha.status).toBe(200);
    expect(beta.status).toBe(200);

    const a = (await alpha.json()) as Array<{ code?: string }>;
    const b = (await beta.json()) as Array<{ code?: string }>;
    // The vacuity guard: alpha really does have something to find.
    expect(a.map((x) => x.code)).toContain('max_players_changed');
    // And it stayed in alpha. An unscoped read would resolve one club's session
    // for both claims and report the same drift twice.
    expect(b.map((x) => x.code)).not.toContain('max_players_changed');
  });

  it('refuses an admin cookie naming a club the person is not in', async () => {
    seedClub('alpha', 1);
    seedGroup('gamma', { ownerMemberId: 'someone-else', name: 'Gamma Club' });
    const res = await anomaliesGet(
      makeRequest('GET', 'http://localhost:3000/api/admin/anomalies', undefined, asAdminOf('gamma')),
    );
    // `isAdminAuthedWithMember` re-reads the membership in the CLAIMED club, so
    // a validly-signed cookie naming a club you do not belong to is admin
    // nowhere. This is the half a signature check alone cannot do.
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/owed-audit — also name-keyed', () => {
  it("audits this club's Ana, not the other club's", async () => {
    seedClub('alpha', 1);
    seedClub('beta', 2);

    const body = await (await owedAuditGet(
      makeRequest('GET', 'http://localhost:3000/api/admin/owed-audit?name=Ana', undefined, asAdminOf('alpha')),
    )).json();

    // ONE session, not two. Both clubs have an unpaid Ana on the same date, so
    // a name-keyed read that ignored the group would return both rows and the
    // admin would chase a stranger for money.
    expect(body.sessionCount).toBe(1);
    expect(body.sessions.map((r: { sessionId?: string }) => r.sessionId ?? '')).toEqual([
      sessionIdFromDate(DATE, 'alpha'),
    ]);
  });
});

describe('GET /api/admin/slice0 — the aggregates', () => {
  it('counts only the claimed club\'s racket savers', async () => {
    seedClub('alpha', 1);
    seedClub('beta', 2);
    // A third saver on the other side, so a leak would be unmistakable.
    const extra = seedMember('Bea');
    seedMembership('beta', extra.id, { name: 'Bea' });
    seedDoc('playerGear', {
      id: `gear-${extra.id}`,
      memberId: extra.id,
      name: 'Bea',
      items: [{ category: 'racket', label: 'Another racket' }],
    });

    const alpha = await (await slice0Get(
      makeRequest('GET', 'http://localhost:3000/api/admin/slice0', undefined, asAdminOf('alpha')),
    )).json();

    // ONE. This is the case that was actually wrong: the read pulled every
    // `playerGear` row in the deployment, so the other club's savers landed in
    // this club's number — and a metric that is too HIGH reads as a good week
    // rather than as a bug, which is why it survived.
    expect(alpha.racketSavers).toBe(1);
  });

  it('counts only the claimed club\'s check-ins', async () => {
    seedClub('alpha', 1);
    seedClub('beta', 2);
    const alpha = await (await slice0Get(
      makeRequest('GET', 'http://localhost:3000/api/admin/slice0', undefined, asAdminOf('alpha')),
    )).json();
    expect(alpha.skill.everCheckedIn).toBe(1);
  });

  it('denominates on the claimed club\'s roster', async () => {
    seedClub('alpha', 1);
    seedClub('beta', 2);
    seedMembership('beta', seedMember('Bea').id, { name: 'Bea' });

    const alpha = await (await slice0Get(
      makeRequest('GET', 'http://localhost:3000/api/admin/slice0', undefined, asAdminOf('alpha')),
    )).json();
    // Ana plus the admin, who is on both rosters. Not the other club's three.
    expect(alpha.skill.rosterSize).toBe(2);
  });
});
