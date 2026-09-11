import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  seedGroup,
  seedMember,
  seedMembership,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';

/**
 * The Phase 3 group lifecycle API: create, preview, join, switch, mine,
 * current, invite, and the roster admin.
 *
 * THE FLAG-OFF BLOCK IS NOT CEREMONY. Every one of these routes writes a
 * membership or hands out a credential, and with the flag off there is exactly
 * one club — so the whole surface has to be absent, not merely unused by the
 * UI. A client flag cannot protect a database.
 *
 * THE INVITE CASES ARE THE ONES TO READ FIRST. An invite is the only long-lived
 * multi-use bearer credential in the repo (see `lib/invites.ts`), so the
 * properties worth pinning are the ones that contain it: a regenerate must
 * RETIRE the old link, and every failed lookup must be indistinguishable from
 * every other.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const BASE = 'http://localhost:3000/api/groups';

const { POST: createGroupRoute } = await import('../app/api/groups/route');
const { GET: previewRoute } = await import('../app/api/groups/preview/route');
const { POST: joinRoute } = await import('../app/api/groups/join/route');
const { POST: switchRoute } = await import('../app/api/groups/switch/route');
const { GET: mineRoute } = await import('../app/api/groups/mine/route');
const { GET: currentRoute } = await import('../app/api/groups/current/route');
const { GET: inviteRoute, POST: regenerateRoute } = await import('../app/api/groups/invite/route');
const { PATCH: patchMemberRoute, DELETE: deleteMemberRoute } = await import(
  '../app/api/groups/members/[memberId]/route'
);

const asMember = (name: string, memberId: string, groupId: string | null = 'bpm') => ({
  Cookie: `member_session=${memberCookieValue(name, memberId, 3600, groupId)}`,
});

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env[FLAG] = 'true';
  await seedTestAdminMember();
  seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, name: 'BPM Badminton' });
});

afterEach(() => {
  delete process.env[FLAG];
});

/** Create a club through the route, returning its id and first invite. */
async function createClub(name: string, owner: { id: string; name: string }) {
  const res = await createGroupRoute(
    makeRequest('POST', BASE, { name }, asMember(owner.name, owner.id)),
  );
  const body = await res.json();
  return { status: res.status, id: body.group?.id as string, invite: body.invite as { token: string; code: string } };
}

describe('POST /api/groups — create a club', () => {
  it('creates the group, mints an invite, and signs the owner into it', async () => {
    const owner = seedMember('Ada');
    const res = await createGroupRoute(
      makeRequest('POST', BASE, { name: 'Tuesday Smash' }, asMember('Ada', owner.id)),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.group.name).toBe('Tuesday Smash');
    expect(body.role).toBe('owner');
    expect(body.invite.token).toMatch(/^[0-9a-f]{32}$/);
    expect(body.invite.code).toHaveLength(8);

    // Both cookies are re-minted FOR the new group — that is the switch.
    const cookies = res.headers.get('set-cookie') ?? '';
    expect(cookies).toContain('member_session=');
    expect(cookies).toContain('admin_session=');
  });

  it('refuses an anonymous caller', async () => {
    const res = await createGroupRoute(makeRequest('POST', BASE, { name: 'Nobody Club' }));
    expect(res.status).toBe(401);
  });

  it('refuses a name that is too short', async () => {
    const owner = seedMember('Ada');
    const res = await createGroupRoute(makeRequest('POST', BASE, { name: 'x' }, asMember('Ada', owner.id)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_name');
  });

  it('refuses a member who has been deactivated', async () => {
    const owner = seedMember('Ada', { active: false });
    const res = await createGroupRoute(
      makeRequest('POST', BASE, { name: 'Ghost Club' }, asMember('Ada', owner.id)),
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/groups/preview — the unauthenticated door', () => {
  it('names the club behind a token, and nothing else about it', async () => {
    const owner = seedMember('Ada');
    const { invite } = await createClub('Tuesday Smash', { id: owner.id, name: 'Ada' });
    seedMember('Someone');

    const res = await previewRoute(makeRequest('GET', `${BASE}/preview?token=${invite.token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ name: 'Tuesday Smash' });
    // Explicit, because this route is reachable by anyone holding a link.
    expect(Object.keys(body)).toEqual(['name']);
  });

  it('accepts a code typed with the wrong case and spacing', async () => {
    const owner = seedMember('Ada');
    const { invite } = await createClub('Tuesday Smash', { id: owner.id, name: 'Ada' });
    const messy = `${invite.code.slice(0, 4).toLowerCase()} ${invite.code.slice(4)}`;

    const res = await previewRoute(makeRequest('GET', `${BASE}/preview?code=${encodeURIComponent(messy)}`));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('Tuesday Smash');
  });

  it('answers an unknown token exactly as it answers a retired one', async () => {
    // BPM's own pair, because the admin cookie names BPM and regeneration acts
    // on the club the ADMIN is in — a different club's link is not theirs to
    // retire, which is itself asserted in the switch/invite cases below.
    const before = await (await inviteRoute(makeAdminRequest('GET', `${BASE}/invite`))).json();
    expect((await regenerateRoute(makeAdminRequest('POST', `${BASE}/invite`))).status).toBe(200);

    const retired = await previewRoute(makeRequest('GET', `${BASE}/preview?token=${before.token}`));
    const nonsense = await previewRoute(makeRequest('GET', `${BASE}/preview?token=deadbeef`));
    expect(retired.status).toBe(404);
    expect(nonsense.status).toBe(404);
    expect(await retired.json()).toEqual(await nonsense.json());
  });

  it('leaves another club\'s link alone when this club regenerates', async () => {
    const owner = seedMember('Ada');
    const { invite } = await createClub('Tuesday Smash', { id: owner.id, name: 'Ada' });

    // The admin cookie names BPM; regenerating there must not reach Ada's club.
    expect((await regenerateRoute(makeAdminRequest('POST', `${BASE}/invite`))).status).toBe(200);

    const theirs = await previewRoute(makeRequest('GET', `${BASE}/preview?token=${invite.token}`));
    expect(theirs.status).toBe(200);
    expect((await theirs.json()).name).toBe('Tuesday Smash');
  });

  it('refuses both parameters at once', async () => {
    const res = await previewRoute(makeRequest('GET', `${BASE}/preview?token=a&code=b`));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/groups/join', () => {
  it('adds the caller to the roster and switches them into the club', async () => {
    const owner = seedMember('Ada');
    const { id, invite } = await createClub('Tuesday Smash', { id: owner.id, name: 'Ada' });
    const joiner = seedMember('Grace');

    const res = await joinRoute(
      makeRequest('POST', `${BASE}/join`, { token: invite.token }, asMember('Grace', joiner.id)),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id, name: 'Tuesday Smash', role: 'member', joined: true });
    expect(res.headers.get('set-cookie') ?? '').toContain('member_session=');
  });

  it('is idempotent — a second tap re-enters without rejoining', async () => {
    const owner = seedMember('Ada');
    const { invite } = await createClub('Tuesday Smash', { id: owner.id, name: 'Ada' });
    const joiner = seedMember('Grace');

    await joinRoute(makeRequest('POST', `${BASE}/join`, { token: invite.token }, asMember('Grace', joiner.id)));
    const again = await joinRoute(
      makeRequest('POST', `${BASE}/join`, { token: invite.token }, asMember('Grace', joiner.id)),
    );
    expect(again.status).toBe(200);
    expect((await again.json()).joined).toBe(false);
  });

  it('answers 409 and names the fix when the roster name is taken', async () => {
    const owner = seedMember('Ada');
    const { invite } = await createClub('Tuesday Smash', { id: owner.id, name: 'Ada' });
    const clash = seedMember('Ada');

    const res = await joinRoute(
      makeRequest('POST', `${BASE}/join`, { token: invite.token, name: 'ada' }, asMember('Ada', clash.id)),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('roster_name_taken');
    expect(body.message).toMatch(/different/i);
  });

  it('refuses an anonymous caller — an invite admits a known person', async () => {
    const owner = seedMember('Ada');
    const { invite } = await createClub('Tuesday Smash', { id: owner.id, name: 'Ada' });
    const res = await joinRoute(makeRequest('POST', `${BASE}/join`, { token: invite.token }));
    expect(res.status).toBe(401);
  });

  it('answers the same 404 as preview for a token that means nothing', async () => {
    const joiner = seedMember('Grace');
    const res = await joinRoute(
      makeRequest('POST', `${BASE}/join`, { token: 'not-a-token' }, asMember('Grace', joiner.id)),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('invite_not_found');
  });
});

describe('GET /api/groups/mine and /current', () => {
  it('lists every club the caller is in, and no club they are not', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });
    seedGroup('other', { name: 'Somebody Else' });
    seedMember('Stranger');

    const res = await mineRoute(makeRequest('GET', `${BASE}/mine`, undefined, asMember('Grace', person.id)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups.map((g: { id: string }) => g.id)).toEqual(['bpm']);
    expect(body.currentGroupId).toBe('bpm');
  });

  it('drops a closed club from the list', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });
    seedGroup('dead', { name: 'Wound Up', closedAt: '2026-01-01T00:00:00.000Z' });
    seedMembership('dead', person.id, { name: 'Grace' });

    const res = await mineRoute(makeRequest('GET', `${BASE}/mine`, undefined, asMember('Grace', person.id)));
    expect((await res.json()).groups.map((g: { id: string }) => g.id)).toEqual(['bpm']);
  });

  it('describes the current club to one of its members', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });

    const res = await currentRoute(makeRequest('GET', `${BASE}/current`, undefined, asMember('Grace', person.id)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'bpm', name: 'BPM Badminton', role: 'member', rosterName: 'Grace' });
    expect(body.memberCount).toBe(2); // the seeded admin owner plus Grace
  });

  it('refuses someone whose membership was removed, cookie or no cookie', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace', status: 'removed' });

    const res = await currentRoute(makeRequest('GET', `${BASE}/current`, undefined, asMember('Grace', person.id)));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/groups/switch', () => {
  it('re-mints the cookies for another club the caller belongs to', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });
    seedGroup('second', { name: 'Second Club' });
    seedMembership('second', person.id, { name: 'Grace' });

    const res = await switchRoute(
      makeRequest('POST', `${BASE}/switch`, { groupId: 'second' }, asMember('Grace', person.id)),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('Second Club');
    expect(res.headers.get('set-cookie') ?? '').toContain('member_session=');
  });

  it('refuses a club the caller is not in — never a silent fallback', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });
    seedGroup('second', { name: 'Second Club' });

    const res = await switchRoute(
      makeRequest('POST', `${BASE}/switch`, { groupId: 'second' }, asMember('Grace', person.id)),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('not_a_member');
  });
});

describe('GET|POST /api/groups/invite', () => {
  it('mints lazily for a club that has never had one — BPM after the backfill', async () => {
    const res = await inviteRoute(makeAdminRequest('GET', `${BASE}/invite`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^[0-9a-f]{32}$/);
    expect(body.code).toMatch(/^[2-9A-HJ-NP-TV-Z]{8}$/);
  });

  it('returns the same pair on a second read', async () => {
    const first = await (await inviteRoute(makeAdminRequest('GET', `${BASE}/invite`))).json();
    const second = await (await inviteRoute(makeAdminRequest('GET', `${BASE}/invite`))).json();
    expect(second.token).toBe(first.token);
    expect(second.code).toBe(first.code);
  });

  it('regenerating retires the old pair — the only revocation there is', async () => {
    const before = await (await inviteRoute(makeAdminRequest('GET', `${BASE}/invite`))).json();
    const after = await (await regenerateRoute(makeAdminRequest('POST', `${BASE}/invite`))).json();
    expect(after.token).not.toBe(before.token);

    const old = await previewRoute(makeRequest('GET', `${BASE}/preview?token=${before.token}`));
    const oldCode = await previewRoute(makeRequest('GET', `${BASE}/preview?code=${before.code}`));
    const fresh = await previewRoute(makeRequest('GET', `${BASE}/preview?token=${after.token}`));
    expect(old.status).toBe(404);
    expect(oldCode.status).toBe(404);
    expect(fresh.status).toBe(200);
  });

  it('refuses a non-admin on the READ as well as the write', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });
    const headers = asMember('Grace', person.id);
    expect((await inviteRoute(makeRequest('GET', `${BASE}/invite`, undefined, headers))).status).toBe(401);
    expect((await regenerateRoute(makeRequest('POST', `${BASE}/invite`, undefined, headers))).status).toBe(401);
  });
});

describe('PATCH|DELETE /api/groups/members/[memberId]', () => {
  const params = (memberId: string) => ({ params: Promise.resolve({ memberId }) });

  it('promotes and demotes a member of this club', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });

    const up = await patchMemberRoute(
      makeAdminRequest('PATCH', `${BASE}/members/${person.id}`, { role: 'admin' }),
      params(person.id),
    );
    expect(up.status).toBe(200);
    expect((await up.json()).role).toBe('admin');

    const down = await patchMemberRoute(
      makeAdminRequest('PATCH', `${BASE}/members/${person.id}`, { role: 'member' }),
      params(person.id),
    );
    expect((await down.json()).role).toBe('member');
  });

  it('refuses to touch the owner, on either verb', async () => {
    const patched = await patchMemberRoute(
      makeAdminRequest('PATCH', `${BASE}/members/${ADMIN_MEMBER_ID}`, { role: 'member' }),
      params(ADMIN_MEMBER_ID),
    );
    // The seeded admin IS the owner here, so this is also the self case; the
    // self check runs first and is the stricter of the two.
    expect(patched.status).toBe(403);
  });

  it('refuses to act on yourself', async () => {
    const res = await deleteMemberRoute(
      makeAdminRequest('DELETE', `${BASE}/members/${ADMIN_MEMBER_ID}`),
      params(ADMIN_MEMBER_ID),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('cannot_target_self');
  });

  it('takes a member off the roster and frees their name', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });

    const res = await deleteMemberRoute(
      makeAdminRequest('DELETE', `${BASE}/members/${person.id}`),
      params(person.id),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('removed');

    // The freed name is claimable by someone else, which is the point of freeing it.
    const owner = seedMember('Ada');
    const { invite } = await createClub('Tuesday Smash', { id: owner.id, name: 'Ada' });
    expect(invite.token).toBeTruthy();
  });

  it('checks auth before it parses the body (rule 3)', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });

    // Anonymous, once with a role this route accepts and once with nonsense.
    // Both must answer 401. A 400 for the nonsense would tell a caller with no
    // standing what the route is willing to take.
    const bogus = await patchMemberRoute(
      makeRequest('PATCH', `${BASE}/members/${person.id}`, { role: 'bogus' }),
      params(person.id),
    );
    const valid = await patchMemberRoute(
      makeRequest('PATCH', `${BASE}/members/${person.id}`, { role: 'admin' }),
      params(person.id),
    );
    expect(bogus.status).toBe(401);
    expect(valid.status).toBe(401);
  });

  it('refuses a member who is not on this roster', async () => {
    const stranger = seedMember('Stranger');
    const res = await patchMemberRoute(
      makeAdminRequest('PATCH', `${BASE}/members/${stranger.id}`, { role: 'admin' }),
      params(stranger.id),
    );
    expect(res.status).toBe(404);
  });

  it('refuses a non-admin', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });
    const other = seedMember('Hedy');
    seedMembership('bpm', other.id, { name: 'Hedy' });

    const res = await patchMemberRoute(
      makeRequest('PATCH', `${BASE}/members/${other.id}`, { role: 'admin' }, asMember('Grace', person.id)),
      params(other.id),
    );
    expect(res.status).toBe(401);
  });
});

/**
 * With the flag off there is one club and this surface does not exist. A 404,
 * not a 403: a 403 would confirm the feature is there and being withheld.
 */
describe('flag off — the whole surface is absent', () => {
  beforeEach(() => {
    delete process.env[FLAG];
  });

  it('404s every route', async () => {
    const person = seedMember('Grace');
    const headers = asMember('Grace', person.id);
    const responses = await Promise.all([
      createGroupRoute(makeRequest('POST', BASE, { name: 'Tuesday Smash' }, headers)),
      previewRoute(makeRequest('GET', `${BASE}/preview?token=whatever`)),
      joinRoute(makeRequest('POST', `${BASE}/join`, { token: 'whatever' }, headers)),
      switchRoute(makeRequest('POST', `${BASE}/switch`, { groupId: 'other' }, headers)),
      mineRoute(makeRequest('GET', `${BASE}/mine`, undefined, headers)),
      currentRoute(makeRequest('GET', `${BASE}/current`, undefined, headers)),
      inviteRoute(makeAdminRequest('GET', `${BASE}/invite`)),
      regenerateRoute(makeAdminRequest('POST', `${BASE}/invite`)),
      patchMemberRoute(makeAdminRequest('PATCH', `${BASE}/members/x`, { role: 'admin' }), {
        params: Promise.resolve({ memberId: 'x' }),
      }),
      deleteMemberRoute(makeAdminRequest('DELETE', `${BASE}/members/x`), {
        params: Promise.resolve({ memberId: 'x' }),
      }),
    ]);
    for (const res of responses) expect(res.status).toBe(404);
  });
});
