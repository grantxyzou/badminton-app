import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PATCH as patchPlayer, POST as postPlayer } from '@/app/api/players/route';
import { PATCH as patchMe } from '@/app/api/members/me/route';
import { PATCH as patchMember } from '@/app/api/members/route';
import { POST as resetAccess } from '@/app/api/players/reset-access/route';
import { POST as decideAccess } from '@/app/api/admin/access-requests/route';
import { issueAccessRequest } from '@/lib/accessRequest';
import { hashPin } from '@/lib/recoveryHash';
import {
  resetMockStore,
  getStore,
  seedDoc,
  seedSession,
  seedPlayer,
  seedMember,
  seedGroup,
  seedMembership,
  makeRequest,
  setupAdminPin,
  seedTestAdminMember,
  adminCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import type { Member } from '@/lib/types';

/**
 * An admin may not take over someone else's ACCOUNT (Claude Security scan,
 * 2026-11-17, F1–F4). A PIN, a cleared PIN, a recovery code and an approved
 * "let me in" are all ways into an account, and an account is the PERSON:
 * it carries their rank in this club and their standing in every other club.
 * So a club admin may hand one out only for someone who holds no rank here
 * (unless the admin is an organiser) and is on no other club's roster, the
 * rule `reset-access` had for its own club alone.
 *
 * Two attackers, the test admin each time:
 * - IN CLUB: an admin (not an organiser) of BPM, against BPM's organiser.
 * - ACROSS CLUBS: the organiser of a club they made, against a person who
 *   joined it and is an admin of BPM.
 */

vi.mock('@/lib/push', () => ({ sendPushToMembers: vi.fn() }));

const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const BPM = 'bpm';
const X = 'club-x';
const BPM_SESSION = 'session-2026-11-20';
const X_SESSION = `${X}:session-2026-11-20`;

function members(): Member[] {
  return getStore()['members'] as Member[];
}
function memberById(id: string): Member {
  return members().find((m) => m.id === id)!;
}
function cookie(groupId: string): Record<string, string> {
  return { Cookie: `admin_session=${adminCookieValue({ groupId })}` };
}

/** BPM's organiser, Olivia, and the test admin as a plain admin of BPM. */
async function inClub(opts: { victimPin?: boolean } = {}) {
  seedMember('Olivia', {
    id: 'victim-o',
    role: 'admin',
    ...(opts.victimPin ? { pinHash: await hashPin('4826') } : {}),
  });
  seedMembership(BPM, 'victim-o', { name: 'Olivia', role: 'owner' });
  seedMembership(BPM, ADMIN_MEMBER_ID, { name: 'Admin', role: 'admin' });
  const row = seedPlayer(BPM_SESSION, 'Olivia', { memberId: 'victim-o' });
  return { victimId: 'victim-o', name: 'Olivia', row, groupId: BPM, headers: cookie(BPM) };
}

/** Vic: an admin of BPM who joined club X, whose organiser is the test admin. */
async function acrossClubs(opts: { victimPin?: boolean } = {}) {
  seedMember('Vic', {
    id: 'victim-v',
    role: 'admin',
    ...(opts.victimPin ? { pinHash: await hashPin('4826') } : {}),
  });
  seedMembership(BPM, 'victim-v', { name: 'Vic', role: 'admin' });
  seedMembership(X, 'victim-v', { name: 'Vic' });
  seedMembership(X, ADMIN_MEMBER_ID, { name: 'Mallory', role: 'owner' });
  const row = seedPlayer(X_SESSION, 'Vic', { memberId: 'victim-v', groupId: X });
  return { victimId: 'victim-v', name: 'Vic', row, groupId: X, headers: cookie(X) };
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
  seedGroup(BPM, { name: 'BPM Core', ownerMemberId: 'victim-o' });
  seedGroup(X, { name: 'Club X', ownerMemberId: ADMIN_MEMBER_ID });
  seedSession(BPM_SESSION);
  seedDoc('sessions', { id: 'active-session-pointer', sessionId: 'active-session-pointer', activeSessionId: BPM_SESSION });
  seedSession(X_SESSION, { groupId: X });
  seedDoc('sessions', { id: `${X}:active-session-pointer`, sessionId: `${X}:active-session-pointer`, activeSessionId: X_SESSION, groupId: X });
});
afterEach(() => {
  delete process.env[FLAG];
});

describe.each([
  ['in club (admin against the organiser)', inClub, 'organiser_only'],
  ['across clubs (a made-up club against a BPM admin)', acrossClubs, 'other_club'],
] as const)('%s', (_label, setup, refusal) => {
  it('F1: PATCH /api/players will not set their PIN', async () => {
    const t = await setup({ victimPin: true });
    const before = memberById(t.victimId).pinHash;
    const res = await patchPlayer(makeRequest('PATCH', 'http://x/api/players', { id: t.row.id, pin: '5839' }, t.headers));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(refusal);
    expect(memberById(t.victimId).pinHash).toBe(before);
  });

  it('F1: POST /api/players will not give a PIN-less account its first PIN', async () => {
    const t = await setup();
    const res = await postPlayer(makeRequest('POST', 'http://x/api/players', { name: t.name, pin: '5839', sessionSignup: false }, t.headers));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(refusal);
    expect(memberById(t.victimId).pinHash).toBeUndefined();
  });

  it('F3: PATCH /api/members/me will not set their first PIN', async () => {
    const t = await setup();
    const res = await patchMe(makeRequest('PATCH', 'http://x/api/members/me', { name: t.name, newPin: '5839' }, t.headers));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(refusal);
    expect(memberById(t.victimId).pinHash).toBeUndefined();
    expect(res.headers.get('set-cookie') ?? '').not.toContain('member_session=');
  });

  it('F3/F4: PATCH /api/members will not clear their PIN', async () => {
    const t = await setup({ victimPin: true });
    const res = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: t.victimId, clearPin: true }, t.headers));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(refusal);
    expect(memberById(t.victimId).pinHash).toBeTruthy();
  });

  it('reset-access will not issue them a recovery code', async () => {
    const t = await setup({ victimPin: true });
    const res = await resetAccess(makeRequest('POST', 'http://x/api/players/reset-access', { name: t.name }, t.headers));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(refusal);
    expect(memberById(t.victimId).recoveryCode).toBeUndefined();
  });

  it('F2: an admin will not approve a "let me in" ask for them', async () => {
    const t = await setup();
    const { stored } = issueAccessRequest();
    Object.assign(memberById(t.victimId), { accessRequests: [{ ...stored, groupId: t.groupId }] });
    const res = await decideAccess(makeRequest('POST', 'http://x/api/admin/access-requests', {
      memberId: t.victimId, requestId: stored.id, decision: 'approve',
    }, t.headers));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(refusal);
    expect(memberById(t.victimId).accessRequests![0].approvedAt).toBeUndefined();
  });
});

describe('what an admin may still do', () => {
  /** Lin: a plain member of BPM and nowhere else. */
  function lin(opts: { pin?: string } = {}) {
    return (async () => {
      seedMember('Lin', { id: 'lin', ...(opts.pin ? { pinHash: await hashPin(opts.pin) } : {}) });
      seedMembership(BPM, 'lin', { name: 'Lin' });
      seedMembership(BPM, ADMIN_MEMBER_ID, { name: 'Admin', role: 'admin' });
      return { headers: cookie(BPM) };
    })();
  }

  it('clears a plain one-club member’s PIN and issues them a code', async () => {
    const { headers } = await lin({ pin: '4826' });
    const res = await resetAccess(makeRequest('POST', 'http://x/api/players/reset-access', { name: 'Lin' }, headers));
    expect(res.status).toBe(200);
    const clear = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: 'lin', clearPin: true }, headers));
    expect(clear.status).toBe(200);
    expect(memberById('lin').pinHash).toBeUndefined();
  });

  it('F4: sets a plain member’s first PIN without signing the admin’s phone in as them', async () => {
    const { headers } = await lin();
    const res = await patchMe(makeRequest('PATCH', 'http://x/api/members/me', { name: 'Lin', newPin: '5839' }, headers));
    expect(res.status).toBe(200);
    expect(memberById('lin').pinHash).toBeTruthy();
    expect(res.headers.get('set-cookie') ?? '').not.toContain('member_session=');
  });

  it('an organiser may act for an admin of their own club', async () => {
    seedMember('Ada', { id: 'ada', role: 'admin', pinHash: await hashPin('4826') });
    seedMembership(BPM, 'ada', { name: 'Ada', role: 'admin' });
    seedMembership(BPM, ADMIN_MEMBER_ID, { name: 'Admin', role: 'owner' });
    const res = await resetAccess(makeRequest('POST', 'http://x/api/players/reset-access', { name: 'Ada' }, cookie(BPM)));
    expect(res.status).toBe(200);
  });

  it('an admin may act for themselves', async () => {
    seedMembership(BPM, ADMIN_MEMBER_ID, { name: 'Admin', role: 'admin' });
    seedMembership(X, ADMIN_MEMBER_ID, { name: 'Admin' });
    const res = await resetAccess(makeRequest('POST', 'http://x/api/players/reset-access', { name: 'Admin' }, cookie(BPM)));
    expect(res.status).toBe(200);
  });

  it('a person who LEFT another club is not held back by it', async () => {
    const { headers } = await lin({ pin: '4826' });
    seedMembership(X, 'lin', { name: 'Lin', status: 'left' });
    const res = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: 'lin', clearPin: true }, headers));
    expect(res.status).toBe(200);
  });

  it('flag off: every admin is an organiser of the one club, as before', async () => {
    delete process.env[FLAG];
    await inClub({ victimPin: true });
    const res = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: 'victim-o', clearPin: true }, cookie(BPM)));
    expect(res.status).toBe(200);
  });
});
