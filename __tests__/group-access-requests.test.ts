import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as LIST, POST as DECIDE } from '@/app/api/admin/access-requests/route';
import { issueAccessRequest } from '@/lib/accessRequest';
import { POST as ASK } from '@/app/api/members/access-request/route';
import { POST as CLAIM } from '@/app/api/members/access-request/claim/route';
import { readGroupClaim, verifyMemberAuth } from '@/lib/auth';
import {
  resetMockStore,
  getStore,
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
 * The two-club gate for "Ask to be let in" (docs/plans/multi-group.md, Phase 6).
 * A request lives on the PERSON, so nothing on the row says which club they
 * asked; the admin's list and the approve button are narrowed to the admin's
 * own roster, or one club's admin would see — and could let in — another
 * club's people by name.
 */

const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const A = 'club-a';
const B = 'club-b';

function adminIn(groupId: string): string {
  seedMembership(groupId, ADMIN_MEMBER_ID, { name: `Admin ${groupId}`, role: 'owner' });
  return `admin_session=${adminCookieValue({ groupId })}`;
}

/** A member of `groupId` with one open request, as "Ask to be let in" stores it. */
function asking(name: string, groupId: string): { id: string; requestId: string } {
  const { stored } = issueAccessRequest();
  const id = `m-${name.toLowerCase()}-${groupId}`;
  seedMember(name, { id, accessRequests: [stored] });
  seedMembership(groupId, id, { name });
  return { id, requestId: stored.id! };
}

async function list(cookie: string): Promise<Array<{ memberId: string; name: string; requestId: string | null }>> {
  const res = await LIST(makeRequest('GET', 'http://x/api/admin/access-requests', undefined, { Cookie: cookie }));
  expect(res.status).toBe(200);
  return (await res.json()).requests;
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
  seedGroup(A, { name: 'Alpha Club', ownerMemberId: ADMIN_MEMBER_ID });
  seedGroup(B, { name: 'Beta Club', ownerMemberId: ADMIN_MEMBER_ID });
});
afterEach(() => {
  delete process.env[FLAG];
});

describe('access requests are the roster’s, not the deployment’s', () => {
  it("lists only the admin's own club's askers", async () => {
    const alpha = asking('Lin', A);
    asking('Lin', B); // the same name in the other club
    const asA = adminIn(A);
    const rows = await list(asA);
    expect(rows.map((r) => r.memberId)).toEqual([alpha.id]);
  });

  it("refuses to approve or decline another club's asker, with the same 404 as nobody", async () => {
    const beta = asking('Zed', B);
    const asA = adminIn(A);
    const approve = await DECIDE(makeRequest('POST', 'http://x/api/admin/access-requests', {
      memberId: beta.id, requestId: beta.requestId, decision: 'approve',
    }, { Cookie: asA }));
    expect(approve.status).toBe(404);
    const decline = await DECIDE(makeRequest('POST', 'http://x/api/admin/access-requests', {
      memberId: beta.id, decision: 'decline',
    }, { Cookie: asA }));
    expect(decline.status).toBe(404);
    // Untouched: Beta's own admin still sees the request and can let them in.
    const zed = (getStore()['members'] as Member[]).find((m) => m.id === beta.id)!;
    expect(zed.accessRequests).toHaveLength(1);
    expect(zed.accessRequests![0].approvedAt).toBeUndefined();
    const asB = adminIn(B);
    expect((await list(asB)).map((r) => r.memberId)).toEqual([beta.id]);
    const ok = await DECIDE(makeRequest('POST', 'http://x/api/admin/access-requests', {
      memberId: beta.id, requestId: beta.requestId, decision: 'approve',
    }, { Cookie: asB }));
    expect(ok.status).toBe(200);
  });
});

/**
 * A SIGNED-OUT ask names its club through the phone's memory of it
 * (lib/lastClub.ts; docs/plans/multi-group.md, "Ask to be let in", Grant
 * 2026-11-04). Without it the name was looked up on BPM's roster: another
 * club's member never reached their own admins, and a BPM member with the same
 * name took the request, one blind tap from signing the wrong person in.
 */
describe('a signed-out ask carries the club this phone remembers', () => {
  const BPM = 'bpm';

  /** The same name, two different people: BPM's Lin and Alpha's Lin. */
  function twoLins(): { bpmLin: string; alphaLin: string } {
    seedGroup(BPM, { name: 'BPM Core', ownerMemberId: ADMIN_MEMBER_ID });
    seedMember('Lin', { id: 'm-lin-bpm' });
    seedMembership(BPM, 'm-lin-bpm', { name: 'Lin' });
    seedMember('Lin', { id: 'm-lin-alpha' });
    seedMembership(A, 'm-lin-alpha', { name: 'Lin' });
    return { bpmLin: 'm-lin-bpm', alphaLin: 'm-lin-alpha' };
  }

  async function ask(name: string, club?: string): Promise<string> {
    const res = await ASK(makeRequest('POST', 'http://x/api/members/access-request', club ? { name, club } : { name }));
    expect(res.status).toBe(200);
    return (await res.json()).secret;
  }

  async function poll(name: string, secret: string, club?: string): Promise<Response> {
    return CLAIM(makeRequest('POST', 'http://x/api/members/access-request/claim', club ? { name, secret, club } : { name, secret }));
  }

  const requestsOf = (id: string) =>
    (getStore()['members'] as Member[]).find((m) => m.id === id)!.accessRequests ?? [];

  it("reaches the remembered club's admins and never BPM's", async () => {
    const { bpmLin, alphaLin } = twoLins();
    await ask('Lin', A);

    expect(requestsOf(alphaLin)).toHaveLength(1);
    expect(requestsOf(alphaLin)[0].groupId).toBe(A);
    expect(requestsOf(bpmLin)).toHaveLength(0);

    expect((await list(adminIn(A))).map((r) => r.memberId)).toEqual([alphaLin]);
    expect(await list(adminIn(BPM))).toEqual([]);
  });

  it('a same-named BPM member cannot be approved for it, and the claim signs in to the club that asked', async () => {
    const { bpmLin, alphaLin } = twoLins();
    const secret = await ask('Lin', A);
    const requestId = requestsOf(alphaLin)[0].id!;

    // BPM's admin cannot reach Alpha's Lin, and has nobody of their own to approve.
    const asBpm = adminIn(BPM);
    const cross = await DECIDE(makeRequest('POST', 'http://x/api/admin/access-requests', {
      memberId: alphaLin, requestId, decision: 'approve',
    }, { Cookie: asBpm }));
    expect(cross.status).toBe(404);
    const wrongLin = await DECIDE(makeRequest('POST', 'http://x/api/admin/access-requests', {
      memberId: bpmLin, requestId, decision: 'approve',
    }, { Cookie: asBpm }));
    expect(wrongLin.status).not.toBe(200);

    // Alpha's admin approves; a poll that forgot the club finds nothing on BPM's roster.
    const ok = await DECIDE(makeRequest('POST', 'http://x/api/admin/access-requests', {
      memberId: alphaLin, requestId, decision: 'approve',
    }, { Cookie: adminIn(A) }));
    expect(ok.status).toBe(200);
    expect(await (await poll('Lin', secret)).json()).toEqual({ status: 'none' });

    const claimed = await poll('Lin', secret, A);
    expect(await claimed.json()).toMatchObject({ status: 'approved', name: 'Lin' });
    const cookie = claimed.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('member_session=');
    const token = decodeURIComponent(cookie.split('member_session=')[1].split(';')[0]);
    expect(readGroupClaim(token)).toBe(A);
    const session = verifyMemberAuth(makeRequest('GET', 'http://x/api/auth/me', undefined, { Cookie: `member_session=${token}` }));
    expect(session).toMatchObject({ memberId: alphaLin, groupId: A });
  });

  it('a phone that remembers nothing still asks BPM, as before', async () => {
    const { bpmLin, alphaLin } = twoLins();
    await ask('Lin');
    expect(requestsOf(bpmLin)).toHaveLength(1);
    expect(requestsOf(alphaLin)).toHaveLength(0);
  });

  it('a hint that is not a group id, or names a club without that person, stores nothing', async () => {
    const { bpmLin, alphaLin } = twoLins();
    await ask('Lin', B); // Beta has no Lin
    const odd = await ASK(makeRequest('POST', 'http://x/api/members/access-request', { name: 'Lin', club: 'a:name:lin' }));
    expect(odd.status).toBe(200);
    // The odd hint is not a hint, so that ask fell back to BPM, exactly like no hint.
    expect(requestsOf(alphaLin)).toHaveLength(0);
    expect(requestsOf(bpmLin)).toHaveLength(1);
  });

  it('with groups off the hint is ignored', async () => {
    seedMember('Lin', { id: 'm-lin-alpha' });
    seedMembership(A, 'm-lin-alpha', { name: 'Lin' });
    delete process.env[FLAG];
    await ask('Lin', A);
    // Flag off every request is BPM's, whatever the body says.
    expect(requestsOf('m-lin-alpha').map((r) => r.groupId)).toEqual([BPM]);
  });
});
