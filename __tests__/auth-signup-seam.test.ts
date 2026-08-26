import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  seedPointer,
  seedSession,
  getStore,
  makeRequest,
} from './helpers';
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

beforeEach(() => {
  resetMockStore();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
  seedPointer('session-2026-09-03');
  seedSession('session-2026-09-03', { signupOpen: true, maxPlayers: 12 });
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
});

function members() {
  return (getStore()['members'] ?? []) as Array<{ id: string; name: string }>;
}

describe('signup -> session signup seam', () => {
  it('reuses the member created by signup instead of making a second one', async () => {
    const created = await signup(
      makeRequest('POST', SIGNUP, {
        name: 'Carolina',
        email: 'carolina@example.com',
        password: 'a good long password',
      }),
    );
    expect(created.status).toBe(201);
    expect(members()).toHaveLength(1);
    const memberId = members()[0].id;

    // Now the same person signs up for the week on Home, name-only.
    const joined = await joinSession(
      makeRequest('POST', PLAYERS, { name: 'Carolina', sessionId: 'session-2026-09-03' }),
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
    await signup(
      makeRequest('POST', SIGNUP, {
        name: 'Carolina',
        email: 'carolina@example.com',
        password: 'a good long password',
      }),
    );
    await joinSession(
      makeRequest('POST', PLAYERS, { name: 'carolina', sessionId: 'session-2026-09-03' }),
    );
    expect(members()).toHaveLength(1);
  });
});
