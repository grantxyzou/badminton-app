import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  seedGroup,
  seedMember,
  seedMembership,
  makeRequest,
  adminCookieValue,
  getTestAdminName,
  ADMIN_MEMBER_ID,
} from './helpers';
import { POST as overrideRoute } from '@/app/api/operator/membership/route';
import { GET as statusRoute } from '@/app/api/admin/migrate-groups/route';
import { isOperatorId, operatorListConfigured } from '@/lib/operator';
import { readGroup } from '@/lib/groups';

/**
 * Roles v2, PR 3 (docs/plans/roles-v2.md): the OPERATOR and the override.
 *
 * Nobody removes an organiser — which is exactly why one person must be able
 * to. The test admin is the operator: listed in `OPERATOR_MEMBER_IDS`, an
 * admin of BPM, and a nobody in clubx, whose organisers Sam (founder) and
 * Pat they reach only through this route. Three locks — the admin cookie of
 * a listed id, the migration key, and the list itself — are each shown to
 * refuse on their own.
 */
const MULTI = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const KEY = 'test-migration-key-of-sufficient-length';
const before = { multi: process.env[MULTI], key: process.env.MIGRATION_KEY, ops: process.env.OPERATOR_MEMBER_IDS };

let sam: { id: string };
let pat: { id: string };
let ada: { id: string };
let lin: { id: string };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[MULTI] = 'true';
  process.env.MIGRATION_KEY = KEY;
  process.env.OPERATOR_MEMBER_IDS = ADMIN_MEMBER_ID;
  seedGroup('bpm', { ownerMemberId: 'grant' });
  seedMembership('bpm', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'admin' });
  sam = seedMember('Sam');
  pat = seedMember('Pat');
  ada = seedMember('Ada');
  lin = seedMember('Lin');
  seedGroup('clubx', { ownerMemberId: sam.id });
  seedMembership('clubx', sam.id, { name: 'Sam', role: 'owner', joinedAt: '2026-01-01T00:00:00Z' });
  seedMembership('clubx', pat.id, { name: 'Pat', role: 'owner', joinedAt: '2026-02-01T00:00:00Z' });
  seedMembership('clubx', ada.id, { name: 'Ada', role: 'admin', joinedAt: '2026-03-01T00:00:00Z' });
  seedMembership('clubx', lin.id, { name: 'Lin', role: 'member', joinedAt: '2026-04-01T00:00:00Z' });
});
afterEach(() => {
  for (const [k, v] of [[MULTI, before.multi], ['MIGRATION_KEY', before.key], ['OPERATOR_MEMBER_IDS', before.ops]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const withKey = (groupId = 'bpm', key: string | null = KEY) => ({
  Cookie: `admin_session=${adminCookieValue({ groupId })}`,
  ...(key ? { 'x-migration-key': key } : {}),
});
const override = (body: Record<string, unknown>, headers = withKey()) =>
  overrideRoute(makeRequest('POST', 'http://x/api/operator/membership', body, headers));
const rowOf = (memberId: string, groupId = 'clubx') =>
  (getStore()['memberships'] as Array<{ id: string; role: string; status: string }>).find((m) => m.id === `${groupId}:${memberId}`)!;
const records = () => (getStore()['groups'] as Array<Record<string, unknown>>).filter((r) => r.kind === 'operatorAction');

describe('who the operator is', () => {
  it('reads the list from the setting', () => {
    expect(operatorListConfigured()).toBe(true);
    expect(isOperatorId(ADMIN_MEMBER_ID)).toBe(true);
    expect(isOperatorId(sam.id)).toBe(false);
    process.env.OPERATOR_MEMBER_IDS = ` ${sam.id} , ${ADMIN_MEMBER_ID} `;
    expect(isOperatorId(sam.id)).toBe(true);
  });

  it('with the list set, a BPM admin who is not on it is refused — the old rule is gone', async () => {
    process.env.OPERATOR_MEMBER_IDS = sam.id;
    const res = await override({ groupId: 'clubx', memberId: lin.id, role: 'admin' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('operator_only');
    const status = await statusRoute(makeRequest('GET', 'http://x/api/admin/migrate-groups', undefined, withKey()));
    expect(status.status).toBe(403);
  });

  it('with the list UNSET, an admin of BPM is still the operator (the rule until the setting exists)', async () => {
    delete process.env.OPERATOR_MEMBER_IDS;
    expect((await override({ groupId: 'clubx', memberId: lin.id, role: 'admin' })).status).toBe(200);
    const status = await statusRoute(makeRequest('GET', 'http://x/api/admin/migrate-groups', undefined, withKey()));
    expect(status.status).toBe(200);
  });

  it("an organiser of the club itself is not the operator unless listed", async () => {
    // The helper mints cookies for the test admin only, so make THEM clubx's
    // organiser: a valid admin cookie for the club being edited, off the list.
    rowOf(ADMIN_MEMBER_ID, 'bpm').status = 'removed';
    seedMembership('clubx', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'owner' });
    process.env.OPERATOR_MEMBER_IDS = pat.id;
    const res = await override({ groupId: 'clubx', memberId: lin.id, role: 'admin' }, withKey('clubx'));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('operator_only');
  });
});

describe('the locks', () => {
  it('no cookie is 401', async () => {
    const res = await override({ groupId: 'clubx', memberId: lin.id, role: 'admin' }, { 'x-migration-key': KEY });
    expect(res.status).toBe(401);
  });

  it('a listed operator without the key is 401; with no key configured, 503', async () => {
    expect((await override({ groupId: 'clubx', memberId: lin.id, role: 'admin' }, withKey('bpm', null))).status).toBe(401);
    expect((await override({ groupId: 'clubx', memberId: lin.id, role: 'admin' }, withKey('bpm', 'wrong-key-wrong-key'))).status).toBe(401);
    delete process.env.MIGRATION_KEY;
    expect((await override({ groupId: 'clubx', memberId: lin.id, role: 'admin' })).status).toBe(503);
    expect(rowOf(lin.id).role).toBe('member');
  });

  it('is absent with the flag off, and validates the body after the locks', async () => {
    process.env[MULTI] = 'false';
    expect((await override({ groupId: 'clubx', memberId: lin.id, role: 'admin' })).status).toBe(404);
    process.env[MULTI] = 'true';
    expect((await override({ groupId: 'club x', memberId: lin.id, role: 'admin' })).status).toBe(400);
    expect((await override({ groupId: 'clubx', memberId: lin.id, role: 'boss' })).status).toBe(400);
    expect((await override({ groupId: 'clubx', memberId: 'nobody', role: 'admin' })).status).toBe(404);
    expect((await override({ groupId: 'clubz', memberId: lin.id, role: 'admin' })).status).toBe(404);
  });
});

describe('the override', () => {
  it("demotes another club's organiser — the one thing nobody else can do — and writes it down", async () => {
    const res = await override({ groupId: 'clubx', memberId: pat.id, role: 'member' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ groupId: 'clubx', memberId: pat.id, before: 'owner', after: 'member', handedTo: null });
    expect(rowOf(pat.id).role).toBe('member');
    expect(rowOf(sam.id).role).toBe('owner');
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({ actorMemberId: ADMIN_MEMBER_ID, groupId: 'clubx', targetMemberId: pat.id, before: 'owner', after: 'member' });
    const status = await statusRoute(makeRequest('GET', 'http://x/api/admin/migrate-groups', undefined, withKey()));
    expect((await status.json()).operatorActions).toHaveLength(1);
  });

  it('demoting the founder moves the pointer to the remaining organiser', async () => {
    const res = await override({ groupId: 'clubx', memberId: sam.id, role: 'admin' });
    expect(res.status).toBe(200);
    expect((await readGroup('clubx'))?.ownerMemberId).toBe(pat.id);
  });

  it('taking the LAST organiser passes the club on, and says to whom', async () => {
    rowOf(pat.id).status = 'removed';
    const res = await override({ groupId: 'clubx', memberId: sam.id, role: 'member' });
    expect(res.status).toBe(200);
    expect((await res.json()).handedTo).toBe(ada.id);
    expect(rowOf(ada.id).role).toBe('owner');
    expect((await readGroup('clubx'))?.closedAt).toBeUndefined();
    expect(records()[0]).toMatchObject({ handedTo: ada.id });
  });

  it('refuses to take the only person in a club down — closing a club is a different intent', async () => {
    for (const id of [pat.id, ada.id, lin.id]) rowOf(id).status = 'removed';
    const res = await override({ groupId: 'clubx', memberId: sam.id, role: 'member' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('last_member');
    expect(records()).toHaveLength(0);
  });

  it('promotes too, and a no-op change is still recorded', async () => {
    expect((await override({ groupId: 'clubx', memberId: lin.id, role: 'owner' })).status).toBe(200);
    expect(rowOf(lin.id).role).toBe('owner');
    expect((await override({ groupId: 'clubx', memberId: ada.id, role: 'admin' })).status).toBe(200);
    expect(records()).toHaveLength(2);
  });
});
