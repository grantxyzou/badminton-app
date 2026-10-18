import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  seedGroup,
  seedPointer,
  seedSession,
  seedTestAdminMember,
  setupAdminPin,
  getStore,
  makeRequest,
  makeAdminRequest,
  ADMIN_MEMBER_ID,
} from './helpers';
import { mintInvite } from '../lib/invites';
import { POST as signup } from '../app/api/auth/signup/route';
import { POST as joinSession } from '../app/api/players/route';

/**
 * The seam between the two ways a Member can come into existence.
 *
 * `POST /api/auth/signup` creates an identity-only member (no player row,
 * `sessionCount: 0`), bypassing the elaborate resolve-or-create path inside
 * `POST /api/players`. If that path did not RECOGNISE the member signup just
 * created, the same person would end up with two `members` rows sharing one
 * name — and since `members` is partitioned on `/id`, a cross-partition name
 * lookup with no ORDER BY picks between them arbitrarily. That id is the
 * storage key for drills, assessments, kudos and gear, so the duplicate would
 * scatter one person's history across two records.
 *
 * `__tests__/member-resolve-canary.test.ts` pins the SHAPE of that lookup, but
 * it cannot see this: the duplicate would arrive through a legitimate second
 * writer, not a copied query.
 */
const SIGNUP = 'http://localhost:3000/bpm/api/auth/signup';
const PLAYERS = 'http://localhost:3000/bpm/api/players';

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  // Members only: a new account needs an invite, so BPM must exist to mint one.
  seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, name: 'BPM Badminton' });
  seedPointer('session-2026-09-03');
  seedSession('session-2026-09-03', { signupOpen: true, maxPlayers: 12 });
});
afterEach(() => {
});

/** Every member but the seeded test admin. */
function members() {
  return ((getStore()['members'] ?? []) as Array<{ id: string; name: string }>).filter(
    (m) => m.id !== ADMIN_MEMBER_ID,
  );
}

async function signupCarolina() {
  const invite = await mintInvite('bpm', ADMIN_MEMBER_ID);
  return signup(
    makeRequest('POST', SIGNUP, {
      name: 'Carolina',
      email: 'carolina@example.com',
      password: 'a good long password',
      inviteToken: invite!.token,
    }),
  );
}

/** The `member_session` cookie a sign-up response set, as a Cookie header. */
function sessionCookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .find((c) => c.startsWith('member_session='))!
    .split(';')[0];
}

describe('signup -> session signup seam', () => {
  it('reuses the member created by signup instead of making a second one', async () => {
    const created = await signupCarolina();
    expect(created.status).toBe(201);
    expect(members()).toHaveLength(1);
    const memberId = members()[0].id;

    // Now the same person signs up for the week on Home, with the session
    // cookie signup minted (members only: the name comes from that account).
    const joined = await joinSession(
      makeRequest('POST', PLAYERS, {}, { Cookie: sessionCookieFrom(created) }),
    );
    expect(joined.status).toBe(201);

    // Exactly ONE member, and the player row points at it.
    expect(members()).toHaveLength(1);
    expect(members()[0].id).toBe(memberId);

    const players = (getStore()['players'] ?? []) as Array<{ name: string; memberId?: string }>;
    expect(players).toHaveLength(1);
    expect(players[0].memberId).toBe(memberId);
  });

  it('matches case-insensitively, the way every other name lookup does', async () => {
    // Only an ADMIN still signs someone up by a typed name (members only), so
    // that is the path whose name lookup must recognise signup's member.
    expect((await signupCarolina()).status).toBe(201);
    const joined = await joinSession(
      makeAdminRequest('POST', PLAYERS, { name: 'carolina', sessionId: 'session-2026-09-03' }),
    );
    expect(joined.status).toBe(201);
    expect(members()).toHaveLength(1);
  });
});
