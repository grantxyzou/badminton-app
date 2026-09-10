import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  seedDoc,
  setupAdminPin,
  seedTestAdminMember,
  seedGroup,
  seedMembership,
  seedSession,
  seedPlayer,
  makeRequest,
  adminCookieValue,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { GET as sessionGet } from '@/app/api/session/route';
import { GET as playersGet } from '@/app/api/players/route';
import { GET as announcementsGet } from '@/app/api/announcements/route';
import { GET as birdsGet, POST as birdsPost } from '@/app/api/birds/route';
import { POINTER_ID, sessionIdFromDate } from '@/lib/cosmos';
import { groupDocId } from '@/lib/groupScope';

/**
 * THE TWO-GROUP ROUTE SWEEP — the proof Phase 1a could not write.
 *
 * Every isolation test before this one drives a route as BPM and asserts a row
 * stamped `other` does not come back. That is half a proof. It cannot fail if a
 * route simply returns NOTHING, and it never shows that a request belonging to
 * another club sees its OWN rows — which is the half that says groups work,
 * rather than that one group is empty.
 *
 * So every case here runs the SAME route TWICE, under two real cookies
 * carrying two real `groupId` claims, and asserts both directions:
 *
 *   A under cookie A  → sees A, and only A     (the vacuity guard)
 *   A under cookie B  → does not see A at all  (the isolation)
 *
 * Neither group is BPM on purpose. BPM is the tolerated default — an unstamped
 * row reads as its own and `resolveGroupId` falls back to it — so a sweep that
 * used BPM as one side could pass on the fallback rather than on the claim.
 *
 * This is only writable now because `resolveGroupId` reads the cookie claim
 * (Phase 2), which is why the plan parked it as a `[ ]` through all of Phase 1.
 */
const A = 'club-a';
const B = 'club-b';
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
let ip = 0;

/** An admin cookie for one club, plus the membership that admits it. */
function adminIn(groupId: string) {
  seedMembership(groupId, ADMIN_MEMBER_ID, { name: `Admin ${groupId}`, role: 'owner' });
  return `admin_session=${adminCookieValue({ groupId })}`;
}
const memberIn = (groupId: string, name: string, memberId: string) =>
  `member_session=${memberCookieValue(name, memberId, 3600, groupId)}`;

const req = (url: string, cookie: string) =>
  makeRequest('GET', url, undefined, { Cookie: cookie, 'X-Client-IP': `10.8.0.${++ip}` });

/** A club with its own session, pointer, roster line and announcement. */
function seedClub(groupId: string, marker: string) {
  const iso = '2026-09-03T19:00:00-07:00';
  const sessionId = sessionIdFromDate(iso, groupId);
  seedGroup(groupId);
  seedSession(sessionId, { groupId, datetime: iso, title: `${marker} night` });
  seedDoc('sessions', {
    id: groupDocId(groupId, POINTER_ID),
    sessionId: groupDocId(groupId, POINTER_ID),
    groupId,
    activeSessionId: sessionId,
  });
  seedPlayer(sessionId, marker, { groupId });
  seedDoc('announcements', { id: `ann-${groupId}`, sessionId, groupId, message: `${marker} announcement` });
  seedDoc('birds', {
    id: `bird-${groupId}`,
    groupId,
    name: `${marker} shuttles`,
    tubes: 4,
    totalCost: 80,
    costPerTube: 20,
    date: '2026-09-01',
  });
  return sessionId;
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  // No BPM membership: every case here is an admin of club A or club B, and a
  // BPM one would let an admin-gated route resolve standing that has nothing to
  // do with the club under test.
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
});
afterEach(() => {
  delete process.env[FLAG];
});

describe('the same route, two clubs, two cookies', () => {
  it('the active session is the CLAIMED club’s, both ways', async () => {
    seedClub(A, 'Alpha');
    seedClub(B, 'Beta');

    const a = await (await sessionGet(req('http://x/api/session', memberIn(A, 'Ann', 'm-ann')))).text();
    expect(a).toContain('Alpha night');
    expect(a).not.toContain('Beta night');

    const b = await (await sessionGet(req('http://x/api/session', memberIn(B, 'Ben', 'm-ben')))).text();
    expect(b).toContain('Beta night');
    expect(b).not.toContain('Alpha night');
  });

  it('the roster is the claimed club’s', async () => {
    seedClub(A, 'Alpha');
    seedClub(B, 'Beta');

    const a = await (await playersGet(req('http://x/api/players', memberIn(A, 'Ann', 'm-ann')))).text();
    expect(a).toContain('Alpha');
    expect(a).not.toContain('Beta');

    const b = await (await playersGet(req('http://x/api/players', memberIn(B, 'Ben', 'm-ben')))).text();
    expect(b).toContain('Beta');
    expect(b).not.toContain('Alpha');
  });

  it('announcements are the claimed club’s', async () => {
    seedClub(A, 'Alpha');
    seedClub(B, 'Beta');

    const a = await (await announcementsGet(req('http://x/api/announcements', memberIn(A, 'Ann', 'm-ann')))).text();
    expect(a).toContain('Alpha announcement');
    expect(a).not.toContain('Beta announcement');

    const b = await (await announcementsGet(req('http://x/api/announcements', memberIn(B, 'Ben', 'm-ben')))).text();
    expect(b).toContain('Beta announcement');
    expect(b).not.toContain('Alpha announcement');
  });

  it('an ADMIN sees only the club their cookie claims, and is admitted by the membership there', async () => {
    seedClub(A, 'Alpha');
    seedClub(B, 'Beta');

    const a = await (await birdsGet(req('http://x/api/birds', adminIn(A))));
    expect(a.status).toBe(200);
    const aText = await a.text();
    expect(aText).toContain('Alpha shuttles');
    expect(aText).not.toContain('Beta shuttles');

    const b = await (await birdsGet(req('http://x/api/birds', adminIn(B))));
    expect(b.status).toBe(200);
    const bText = await b.text();
    expect(bText).toContain('Beta shuttles');
    expect(bText).not.toContain('Alpha shuttles');
  });

  it('a WRITE re-reads standing in the claimed club; the read does not, by design', async () => {
    seedClub(A, 'Alpha');
    const forged = `admin_session=${adminCookieValue({ groupId: A })}`;

    // The MUTATING verb re-reads the membership every request, so an admin with
    // no standing in the claimed club is refused — which is what makes a
    // demotion take effect immediately rather than at the cookie's 30-day TTL.
    const write = await birdsPost(
      makeRequest('POST', 'http://x/api/birds', { name: 'X', tubes: 1, totalCost: 20, date: '2026-09-02' }, { Cookie: forged, 'X-Client-IP': `10.8.1.${++ip}` }),
    );
    expect(write.status).toBe(401);

    // The READ-ONLY verb deliberately does NOT: `isAdminAuthed` is signature
    // and expiry only, because the claim was role-checked when it was minted
    // and a Cosmos round-trip on every hot read buys a check already made.
    // Pinning it so the asymmetry is a decision on the record rather than an
    // oversight someone "fixes" in either direction by accident.
    const read = await birdsGet(req('http://x/api/birds', forged));
    expect(read.status).toBe(200);
  });

  it('a club with nothing of its own gets an empty answer, not the other club’s', async () => {
    // The failure this guards: a route that ignores the group entirely still
    // passes "B does not see A" when B has rows of its own to show. Give B
    // NOTHING and the only way to pass is to actually resolve the group.
    seedClub(A, 'Alpha');
    seedGroup(B);
    const b = await (await playersGet(req('http://x/api/players', memberIn(B, 'Ben', 'm-ben')))).text();
    expect(b).not.toContain('Alpha');
  });
});
