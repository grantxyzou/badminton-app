import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedGroup,
  seedMembership,
  seedSession,
  seedPlayer,
  seedDoc,
  makeRequest,
  memberCookieValue,
  getStore,
  ADMIN_MEMBER_ID,
} from './helpers';
import { POINTER_ID, sessionIdFromDate } from '@/lib/cosmos';
import { groupDocId } from '@/lib/groupScope';
import { TOMBSTONE_NAME } from '@/lib/memberPurge';
import { DELETE } from '@/app/api/members/me/route';

/**
 * Deleting an account with groups on (audit, 2026-11-05). Lin is in two clubs,
 * X and Z, and organises Z. ANOTHER Lin — a different person — plays in club
 * Y. Before: the purge matched by name in every club, so Y's Lin lost her
 * history (her skills rows were DELETED), only the club the request came from
 * got Lin's seat back, and Z kept showing Lin's own e-mail as its pay-to.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const LIN = 'm-lin';
const OTHER = 'm-other-lin';
const NEXT = new Date(Date.now() + 7 * 86_400_000).toISOString();
const PAST = '2026-08-27T19:00:00-07:00';

type Row = Record<string, unknown> & { id: string };
const rows = (c: string) => (getStore()[c] ?? []) as Row[];
const byId = (c: string, id: string) => rows(c).find((r) => r.id === id);

function club(groupId: string) {
  const activeId = sessionIdFromDate(NEXT, groupId);
  const pastId = sessionIdFromDate(PAST, groupId);
  seedSession(activeId, { groupId, datetime: NEXT, deadline: NEXT });
  seedSession(pastId, { groupId, datetime: PAST, deadline: PAST });
  seedDoc('sessions', { id: groupDocId(groupId, POINTER_ID), sessionId: groupDocId(groupId, POINTER_ID), groupId, activeSessionId: activeId });
  return { activeId, pastId };
}

let x: ReturnType<typeof club>;
let y: ReturnType<typeof club>;
let z: ReturnType<typeof club>;

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
  seedMember('Lin', { id: LIN });
  seedMember('Lin', { id: OTHER });
  seedGroup('clubx', { ownerMemberId: ADMIN_MEMBER_ID });
  seedGroup('cluby', { ownerMemberId: ADMIN_MEMBER_ID });
  seedGroup('clubz', {
    ownerMemberId: LIN,
    settings: { skipDates: [], maxPlayers: 12, eTransferRecipient: { name: 'Lin Wong', email: 'lin@example.com' } },
    joinRequests: [{ id: 'jr1', name: 'Lin', hash: 'h', createdAt: '2026-11-01T00:00:00Z', expiresAt: Date.now() + 60_000, approvedAt: Date.now(), memberId: LIN }],
  });
  seedMembership('clubx', ADMIN_MEMBER_ID, { name: 'Admin', role: 'owner' });
  seedMembership('cluby', ADMIN_MEMBER_ID, { name: 'Admin', role: 'owner' });
  seedMembership('clubx', LIN, { name: 'Lin' });
  seedMembership('clubz', LIN, { name: 'Lin', role: 'owner' });
  seedMembership('clubz', ADMIN_MEMBER_ID, { name: 'Admin', role: 'admin' });
  seedMembership('cluby', OTHER, { name: 'Lin' });
  x = club('clubx');
  y = club('cluby');
  z = club('clubz');

  // Lin holds a seat this week in X AND in Z.
  seedPlayer(x.activeId, 'Lin', { id: 'p-x-seat', groupId: 'clubx', memberId: LIN });
  seedPlayer(z.activeId, 'Lin', { id: 'p-z-seat', groupId: 'clubz', memberId: LIN });
  // The OTHER Lin's history in club Y: a legacy row with no id, a game, skills.
  seedPlayer(y.pastId, 'Lin', { id: 'p-y-legacy', groupId: 'cluby' });
  seedDoc('gameResults', { id: 'g-y', sessionId: y.pastId, groupId: 'cluby', teamA: ['Lin', 'Bao'], teamB: ['Chen', 'Dev'], loggedBy: 'Lin' });
  seedDoc('skills', { id: 'sk-y', sessionId: y.pastId, groupId: 'cluby', name: 'Lin', scores: {}, updatedAt: '2026-08-28T00:00:00Z' });
  // Lin strung a racket for someone in club X.
  seedDoc('stringingJobs', { id: 'job-1', groupId: 'clubx', memberId: 'm-bao', memberName: 'Bao', stringerId: LIN, stringerName: 'Lin' });
});
afterEach(() => {
  delete process.env[FLAG];
});

const deleteLin = () =>
  DELETE(
    makeRequest('DELETE', 'http://x/api/members/me', { confirm: true }, {
      Cookie: `member_session=${memberCookieValue('Lin', LIN, undefined, 'clubx')}`,
    }),
  );

describe('deleting an account in one club of several', () => {
  it('leaves another club’s Lin entirely alone', async () => {
    expect((await deleteLin()).status).toBe(200);
    expect(byId('players', 'p-y-legacy')?.name).toBe('Lin');
    expect(byId('gameResults', 'g-y')).toMatchObject({ teamA: ['Lin', 'Bao'], loggedBy: 'Lin' });
    expect(byId('skills', 'sk-y')).toBeTruthy();
  });

  it('frees the seat in EVERY club they were in, not only the one asked from', async () => {
    const body = await (await deleteLin()).json();
    expect(body.spotsFreed).toBe(2);
    expect(byId('players', 'p-x-seat')).toMatchObject({ removed: true, name: TOMBSTONE_NAME });
    expect(byId('players', 'p-z-seat')).toMatchObject({ removed: true, name: TOMBSTONE_NAME });
  });

  it('takes their pay-to off the club they organised, and their uncollected join request', async () => {
    await deleteLin();
    const z = byId('groups', 'clubz') as { settings?: { eTransferRecipient?: unknown }; joinRequests?: unknown[] };
    expect(z.settings?.eTransferRecipient).toBeUndefined();
    expect(z.joinRequests ?? []).toEqual([]);
  });

  it('takes their name off rackets they strung for others; the job stays the player’s', async () => {
    await deleteLin();
    expect(byId('stringingJobs', 'job-1')).toMatchObject({ memberId: 'm-bao', stringerName: TOMBSTONE_NAME });
  });
});
