import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as LIST, POST as DECIDE } from '@/app/api/admin/access-requests/route';
import { issueAccessRequest } from '@/lib/accessRequest';
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
