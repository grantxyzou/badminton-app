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
  makeAdminRequest,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { rotateClaimLink } from '../lib/claimLinks';

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
const { POST: switchRoute } = await import('../app/api/groups/switch/route');
const { GET: mineRoute } = await import('../app/api/groups/mine/route');
const { GET: currentRoute } = await import('../app/api/groups/current/route');
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

/** Create a club through the route, returning its id and its club link. */
async function createClub(name: string, owner: { id: string; name: string }) {
  const res = await createGroupRoute(
    makeRequest('POST', BASE, { name }, asMember(owner.name, owner.id)),
  );
  const body = await res.json();
  return { status: res.status, id: body.group?.id as string, link: body.link as { token: string } };
}

describe('POST /api/groups — create a club', () => {
  it('creates the group, makes its club link, and signs the owner into it', async () => {
    const owner = seedMember('Ada');
    const res = await createGroupRoute(
      makeRequest('POST', BASE, { name: 'Tuesday Smash' }, asMember('Ada', owner.id)),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.group.name).toBe('Tuesday Smash');
    expect(body.role).toBe('owner');
    // The club's link, ready to share (docs/plans/one-way-in.md, step 5); no
    // one-time invite and no code.
    expect(body.link.token).toMatch(/^[0-9a-f]{32}$/);
    expect(body.invite).toBeUndefined();

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
  it('names the club behind its link, and nothing else about it', async () => {
    const owner = seedMember('Ada');
    const { link } = await createClub('Tuesday Smash', { id: owner.id, name: 'Ada' });
    seedMember('Someone');

    const res = await previewRoute(makeRequest('GET', `${BASE}/preview?token=${link.token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ name: 'Tuesday Smash', kind: 'door' });
    // Explicit, because this route is reachable by anyone holding a link.
    expect(Object.keys(body).sort()).toEqual(['kind', 'name']);
    // The same link sent as `?claim=` reads the same.
    expect(await (await previewRoute(makeRequest('GET', `${BASE}/preview?claim=${link.token}`))).json()).toEqual(body);
  });

  it('answers an unknown link, a replaced one and an old invite code alike', async () => {
    // A replaced link and a nonsense one must be indistinguishable, or the
    // preview is an oracle for which links ever existed.
    const owner = seedMember('Ada');
    const { id, link } = await createClub('Tuesday Smash', { id: owner.id, name: 'Ada' });
    await rotateClaimLink(id, owner.id);

    const replaced = await previewRoute(makeRequest('GET', `${BASE}/preview?token=${link.token}`));
    const code = await previewRoute(makeRequest('GET', `${BASE}/preview?code=ABCD2345`));
    const nonsense = await previewRoute(makeRequest('GET', `${BASE}/preview?token=deadbeef`));
    expect(replaced.status).toBe(404);
    expect(code.status).toBe(404);
    expect(nonsense.status).toBe(404);
    expect(await replaced.json()).toEqual(await nonsense.json());
  });

  it('refuses two parameters at once', async () => {
    const res = await previewRoute(makeRequest('GET', `${BASE}/preview?token=a&claim=b`));
    expect(res.status).toBe(404);
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

  /**
   * Rule 4 — the limit runs BEFORE the auth check, on both of these.
   *
   * They were the only two handlers in the group API with no limit at all, and
   * `/mine` is the costliest read in it: a cross-partition query on
   * `memberships`, then one `readGroup` point read per club the caller is in,
   * on a B1 tier. `/current` pays for `requireGroupMember`, which is the one
   * auth check here that hits Cosmos, and then lists the whole roster.
   *
   * The second half is the half that matters: once the bucket is spent the
   * ANONYMOUS caller from the same IP gets 429 too, not 401. A limit placed
   * after the auth check can be walked past by dropping the cookie.
   */
  it('rate limits /mine before the auth check', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });
    const ip = '203.0.113.41';
    const authed = { ...asMember('Grace', person.id), 'X-Client-IP': ip };

    let last = await mineRoute(makeRequest('GET', `${BASE}/mine`, undefined, authed));
    for (let i = 0; i < 80 && last.status !== 429; i += 1) {
      last = await mineRoute(makeRequest('GET', `${BASE}/mine`, undefined, authed));
    }
    expect(last.status).toBe(429);

    const anon = await mineRoute(makeRequest('GET', `${BASE}/mine`, undefined, { 'X-Client-IP': ip }));
    expect(anon.status).toBe(429);
  });

  it('rate limits /current before the auth check', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });
    const ip = '203.0.113.42';
    const authed = { ...asMember('Grace', person.id), 'X-Client-IP': ip };

    let last = await currentRoute(makeRequest('GET', `${BASE}/current`, undefined, authed));
    for (let i = 0; i < 80 && last.status !== 429; i += 1) {
      last = await currentRoute(makeRequest('GET', `${BASE}/current`, undefined, authed));
    }
    expect(last.status).toBe(429);

    const anon = await currentRoute(makeRequest('GET', `${BASE}/current`, undefined, { 'X-Client-IP': ip }));
    expect(anon.status).toBe(429);
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

  it('never hands the club\'s payment details to a member (rule 10)', async () => {
    // Seeded ON the group doc, which is where Phase 4 moves it. No earlier test
    // put it there, which is exactly why the first cut shipped it to everyone.
    const groups = getStore()['groups'] as Record<string, unknown>[];
    const bpm = groups.find((g) => g.id === 'bpm')!;
    bpm.settings = {
      skipDates: [],
      maxPlayers: 12,
      eTransferRecipient: { name: 'Grant', email: 'money@example.com' },
    };

    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });
    const asPlayer = await currentRoute(
      makeRequest('GET', `${BASE}/current`, undefined, asMember('Grace', person.id)),
    );
    const player = await asPlayer.json();
    expect(player.settings.eTransferRecipient).toBeUndefined();
    expect(JSON.stringify(player)).not.toContain('money@example.com');

    // And not to the owner either — an admin reads it through /api/admin/settings.
    const asOwner = await currentRoute(
      makeRequest('GET', `${BASE}/current`, undefined, asMember('Test Admin', ADMIN_MEMBER_ID)),
    );
    expect(JSON.stringify(await asOwner.json())).not.toContain('money@example.com');
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

  it('refuses a group id that is not the shape this app mints', async () => {
    const person = seedMember('Grace');
    seedMembership('bpm', person.id, { name: 'Grace' });

    // A format specifier and a newline: `groupId` reaches `groupScope()` and the
    // `[group-leak]` log, and that sentinel is what Phase 5's flag flip is gated
    // on, so a caller must not be able to write lines into it.
    for (const bad of ['%s%s%s', 'bpm\nFAKE [group-leak] line', 'invite:' + 'a'.repeat(64), '../bpm']) {
      const res = await switchRoute(
        makeRequest('POST', `${BASE}/switch`, { groupId: bad }, asMember('Grace', person.id)),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_group');
    }
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
    const { link } = await createClub('Tuesday Smash', { id: owner.id, name: 'Ada' });
    expect(link.token).toBeTruthy();
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

  // `preview` is not behind this flag: it names the club behind a link.
  it('404s every route', async () => {
    const person = seedMember('Grace');
    const headers = asMember('Grace', person.id);
    const responses = await Promise.all([
      createGroupRoute(makeRequest('POST', BASE, { name: 'Tuesday Smash' }, headers)),
      switchRoute(makeRequest('POST', `${BASE}/switch`, { groupId: 'other' }, headers)),
      mineRoute(makeRequest('GET', `${BASE}/mine`, undefined, headers)),
      currentRoute(makeRequest('GET', `${BASE}/current`, undefined, headers)),
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
