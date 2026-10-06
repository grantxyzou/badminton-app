import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMockStore, setupAdminPin, seedGroup, seedTestAdminMember, makeRequest, ADMIN_MEMBER_ID } from './helpers';
import { mintInvite, resolveInvite } from '../lib/invites';

/**
 * A claimed one-time invite must be put back when the sign-up blows up
 * ANYWHERE after the claim — not only inside the route's own try/catch. The
 * first cut settled the claim after `await finish()`, so a throw out of
 * `finish` (a lookup before its inner try, a database error) skipped the
 * release and the invite was lost with nobody told. Found by the review bot
 * on #542.
 */
const reserveIdentity = vi.fn();
vi.mock('@/lib/authIdentity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/authIdentity')>();
  return { ...actual, reserveIdentity: (...args: unknown[]) => reserveIdentity(...args) };
});

const { POST: signupRoute } = await import('../app/api/auth/signup/route');
const SIGNUP = 'http://localhost:3000/bpm/api/auth/signup';
const FLAGS = ['NEXT_PUBLIC_FLAG_MEMBERS_ONLY', 'NEXT_PUBLIC_FLAG_MULTI_GROUP', 'NEXT_PUBLIC_FLAG_AUTH_PROVIDERS'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  reserveIdentity.mockReset();
  for (const f of FLAGS) saved[f] = process.env[f];
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
  process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
  delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
  await seedTestAdminMember();
  seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, name: 'BPM Badminton' });
});

afterEach(() => {
  for (const f of FLAGS) {
    if (saved[f] === undefined) delete process.env[f];
    else process.env[f] = saved[f];
  }
});

describe('a claimed invite is released when the sign-up throws', () => {
  it('a database error reserving the email: the invite is still live afterwards', async () => {
    reserveIdentity.mockRejectedValueOnce(new Error('cosmos down'));
    const inv = await mintInvite('bpm', ADMIN_MEMBER_ID);
    await expect(
      signupRoute(makeRequest('POST', SIGNUP, { name: 'Carolina', email: 'c@example.com', password: 'a good long password', inviteToken: inv!.token })),
    ).rejects.toThrow('cosmos down');
    expect(await resolveInvite(inv!.token, 'invite')).toBe('bpm');
  });
});
