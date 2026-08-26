import { describe, it, expect } from 'vitest';
import { resolveOAuthIdentity, type ResolveInput } from '../lib/authResolve';

function input(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    existingIdentityMemberId: null,
    sessionMemberId: null,
    providerEmail: null,
    providerEmailVerified: false,
    memberIdByVerifiedEmail: null,
    ...over,
  };
}

describe('resolveOAuthIdentity', () => {
  it('1. signs in when the provider identity is already known', () => {
    expect(resolveOAuthIdentity(input({ existingIdentityMemberId: 'm1' }))).toEqual({
      kind: 'signin',
      memberId: 'm1',
    });
  });

  it('1 beats 2: a known identity wins over whoever is signed in on this browser', () => {
    // Otherwise signing into your own Google account on a friend's phone would
    // silently graft your Google identity onto THEIR member record.
    expect(
      resolveOAuthIdentity(input({ existingIdentityMemberId: 'm1', sessionMemberId: 'm2' })),
    ).toEqual({ kind: 'signin', memberId: 'm1' });
  });

  it('2. links to the member already authenticated on this browser', () => {
    // This is the upgrade path: you are signed in as yourself, you tap
    // "Connect Google", and the identity attaches to the member you already are.
    expect(resolveOAuthIdentity(input({ sessionMemberId: 'm2' }))).toEqual({
      kind: 'link',
      memberId: 'm2',
    });
  });

  it('3. links on a verified email match', () => {
    expect(
      resolveOAuthIdentity(
        input({
          providerEmail: 'lin@example.com',
          providerEmailVerified: true,
          memberIdByVerifiedEmail: 'm3',
        }),
      ),
    ).toEqual({ kind: 'link', memberId: 'm3' });
  });

  it('3 requires the PROVIDER to assert verification', () => {
    // Some providers hand back an address they have never confirmed. Trusting
    // it would let anyone claim an account by setting that address on their
    // own profile at the provider.
    expect(
      resolveOAuthIdentity(
        input({
          providerEmail: 'lin@example.com',
          providerEmailVerified: false,
          memberIdByVerifiedEmail: 'm3',
        }),
      ),
    ).toEqual({ kind: 'new-account' });
  });

  it('3 requires OUR side to be verified too', () => {
    // memberIdByVerifiedEmail is null when the member's own email is
    // unverified. An unverified address is a claim, not proof -- otherwise
    // signing up with someone else's address would hand you their account.
    expect(
      resolveOAuthIdentity(
        input({
          providerEmail: 'lin@example.com',
          providerEmailVerified: true,
          memberIdByVerifiedEmail: null,
        }),
      ),
    ).toEqual({ kind: 'new-account' });
  });

  it('4. falls through to a new account when nothing else matches', () => {
    expect(resolveOAuthIdentity(input({ providerEmail: 'new@example.com' }))).toEqual({
      kind: 'new-account',
    });
  });

  it('never resolves by name — there is no name in the input at all', () => {
    // Structural assertion. Member names are enumerable via GET /api/members,
    // so a name can never be an input to this decision; keeping it out of the
    // type is what makes that unforgettable rather than merely intended.
    const keys = Object.keys(input());
    expect(keys.some((k) => k.toLowerCase().includes('name'))).toBe(false);
  });
});
