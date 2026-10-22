import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import {
  resetMockStore,
  getStore,
  seedDoc,
  seedMember,
  seedGroup,
  seedMembership,
  seedSession,
  seedPlayer,
  setupAdminPin,
  makeRequest,
  memberCookieValue,
} from './helpers';
import { POINTER_ID, sessionIdFromDate } from '@/lib/cosmos';
import { groupDocId } from '@/lib/groupScope';
import { mintWidgetToken, verifyMemberAuth, verifyWidgetToken } from '@/lib/auth';
import { GET as widgetGet } from '@/app/api/widget/route';
import { POST as tokenPost } from '@/app/api/widget/token/route';
import { POST as joinPost, DELETE as joinDelete } from '@/app/api/widget/join/route';
import type { WidgetSnapshot } from '@/lib/widget';

/**
 * THE WIDGET'S SERVER HALF (docs/plans/native-widgets.md).
 *
 * The widget has no cookies, so it reads and acts with a bearer pass the app
 * mints. Three things matter and each has a block here:
 * - the pass is its own audience: not a member cookie, not an admin one, and a
 *   member cookie is not a pass;
 * - the snapshot is the CLAIMED club's — "Ana" is one person on two rosters
 *   with a session in each, so only the group can separate them;
 * - Join and Undo are the sign-up route's own rules, not a second copy.
 */
const A = 'club-a';
const B = 'club-b';
const ANA = 'm-ana';
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const NEXT = new Date(Date.now() + 3 * 86_400_000).toISOString();

const anaCookie = (groupId: string) => `member_session=${memberCookieValue('Ana', ANA, 3600, groupId)}`;

function seedClub(groupId: string, marker: string, inCount: number, max = 12) {
  const activeId = sessionIdFromDate(NEXT, groupId);
  seedGroup(groupId, { name: `${marker} Club` });
  seedMembership(groupId, ANA, { name: 'Ana' });
  seedSession(activeId, { groupId, datetime: NEXT, deadline: NEXT, title: `${marker} next`, maxPlayers: max });
  seedDoc('sessions', { id: groupDocId(groupId, POINTER_ID), sessionId: groupDocId(groupId, POINTER_ID), groupId, activeSessionId: activeId });
  for (let i = 0; i < inCount; i++) seedPlayer(activeId, `${marker}${i}`, { groupId, memberId: `m-${marker}${i}` });
  return activeId;
}

async function passFor(groupId: string): Promise<string> {
  const res = await tokenPost(makeRequest('POST', 'http://x/bpm/api/widget/token', {}, { Cookie: anaCookie(groupId) }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const read = async (token: string) => widgetGet(makeRequest('GET', 'http://x/bpm/api/widget', undefined, bearer(token)));

let aSession: string;
let bSession: string;

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env[FLAG] = 'true';
  seedMember('Ana', { id: ANA });
  aSession = seedClub(A, 'Alpha', 3);
  bSession = seedClub(B, 'Beta', 7);
});
afterEach(() => {
  delete process.env[FLAG];
});

describe('the widget pass', () => {
  it('needs a signed-in member to mint', async () => {
    const res = await tokenPost(makeRequest('POST', 'http://x/bpm/api/widget/token', {}));
    expect(res.status).toBe(401);
  });

  it('is refused as a member cookie, and a member cookie is refused as a pass', async () => {
    const token = await passFor(A);
    const asCookie = makeRequest('GET', 'http://x/', undefined, { Cookie: `member_session=${token}` }) as NextRequest;
    expect(verifyMemberAuth(asCookie)).toBeNull();
    const cookieAsBearer = makeRequest('GET', 'http://x/', undefined, bearer(memberCookieValue('Ana', ANA, 3600, A)));
    expect(verifyWidgetToken(cookieAsBearer)).toBeNull();
    expect((await read(memberCookieValue('Ana', ANA, 3600, A))).status).toBe(401);
  });

  it('stops working the moment the membership does', async () => {
    const token = await passFor(A);
    expect((await read(token)).status).toBe(200);
    const row = (getStore().memberships as { id: string; status?: string }[]).find((m) => m.id === `${A}:${ANA}`)!;
    row.status = 'removed';
    expect((await read(token)).status).toBe(401);
  });

  it('answers 401 with no pass at all', async () => {
    const res = await widgetGet(makeRequest('GET', 'http://x/bpm/api/widget'));
    expect(res.status).toBe(401);
  });
});

describe('the snapshot is the claimed club’s', () => {
  it('reads each club’s own session under each club’s pass', async () => {
    for (const [club, sessionId, count] of [[A, aSession, 3], [B, bSession, 7]] as const) {
      const res = await read(await passFor(club));
      expect(res.status).toBe(200);
      const snap = (await res.json()) as WidgetSnapshot;
      expect(snap.session?.id).toBe(sessionId);
      expect(snap.session?.inCount).toBe(count);
      expect(snap.session?.me).toBe('out');
    }
  });

  it('carries the level from the check-ins, oldest first, with the work-on skill', async () => {
    const ratings = (v: number) => [
      { skillKey: 'net_play', value: v - 1 },
      { skillKey: 'clears_lifts', value: v + 1 },
    ];
    seedDoc('assessments', { id: 'a1', memberId: ANA, takenAt: '2026-09-10T00:00:00Z', ratings: ratings(2), overall: 2.3, phase: 'exploration' });
    seedDoc('assessments', { id: 'a2', memberId: ANA, takenAt: '2026-10-10T00:00:00Z', ratings: ratings(3), overall: 3.1, phase: 'switch' });
    seedDoc('assessments', { id: 'a3', memberId: ANA, takenAt: '2026-09-24T00:00:00Z', ratings: ratings(3), overall: 2.7, phase: 'switch' });
    const snap = (await (await read(await passFor(A))).json()) as WidgetSnapshot;
    expect(snap.level?.overall).toBe(3.1);
    expect(snap.level?.phaseLabel).toBe('Intermediate');
    expect(snap.level?.history).toEqual([2.3, 2.7, 3.1]);
    expect(snap.level?.delta).toBe(0.4);
    expect(snap.level?.prevAt).toBe('2026-09-24T00:00:00Z');
  });

  it('has no level, rather than a zero, before the first check-in', async () => {
    const snap = (await (await read(await passFor(A))).json()) as WidgetSnapshot;
    expect(snap.level).toBeNull();
  });
});

describe('Join and Undo are the sign-up route', () => {
  it('joins, and the answer is the server’s, not a guess', async () => {
    const token = await passFor(A);
    const res = await joinPost(makeRequest('POST', 'http://x/bpm/api/widget/join', {}, bearer(token)));
    expect(res.status).toBe(200);
    const { snapshot } = (await res.json()) as { snapshot: WidgetSnapshot };
    expect(snapshot.session?.me).toBe('in');
    expect(snapshot.session?.inCount).toBe(4);
    // Into club A only.
    const players = getStore().players as { sessionId: string; memberId?: string; removed?: boolean }[];
    expect(players.filter((p) => p.memberId === ANA && !p.removed).map((p) => p.sessionId)).toEqual([aSession]);
  });

  it('undoes, giving the spot back', async () => {
    const token = await passFor(A);
    await joinPost(makeRequest('POST', 'http://x/bpm/api/widget/join', {}, bearer(token)));
    const res = await joinDelete(makeRequest('DELETE', 'http://x/bpm/api/widget/join', {}, bearer(token)));
    expect(res.status).toBe(200);
    const { snapshot } = (await res.json()) as { snapshot: WidgetSnapshot };
    expect(snapshot.session?.me).toBe('out');
    expect(snapshot.session?.inCount).toBe(3);
  });

  it('passes the sign-up route’s refusals through: full without the waitlist', async () => {
    resetMockStore();
    seedMember('Ana', { id: ANA });
    seedClub(A, 'Alpha', 2, 2);
    const token = await passFor(A);
    const full = await joinPost(makeRequest('POST', 'http://x/bpm/api/widget/join', {}, bearer(token)));
    expect(full.status).toBe(409);
    const waitlisted = await joinPost(makeRequest('POST', 'http://x/bpm/api/widget/join', { waitlist: true }, bearer(token)));
    expect(waitlisted.status).toBe(200);
    const { snapshot } = (await waitlisted.json()) as { snapshot: WidgetSnapshot };
    expect(snapshot.session?.me).toBe('waitlist');
    expect(snapshot.session?.waitlistPosition).toBe(1);
  });

  it('refuses when sign-ups are not open, as Home does', async () => {
    const s = (getStore().sessions as { id: string; signupOpen?: boolean }[]).find((x) => x.id === aSession)!;
    s.signupOpen = false;
    const res = await joinPost(makeRequest('POST', 'http://x/bpm/api/widget/join', {}, bearer(await passFor(A))));
    expect(res.status).toBe(403);
  });

  it('refuses without a pass', async () => {
    expect((await joinPost(makeRequest('POST', 'http://x/bpm/api/widget/join', {}))).status).toBe(401);
  });
});

describe('mintWidgetToken', () => {
  it('lasts sixty days', () => {
    const { expiresAt } = mintWidgetToken({ memberId: ANA, name: 'Ana', groupId: A });
    const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(60);
  });
});
