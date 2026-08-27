/**
 * The OAuth identity resolution table, as a PURE function.
 *
 * WHY IT IS PURE
 * --------------
 * This is the security-critical decision in the whole provider flow — it
 * decides whose account a Google or Apple sign-in lands in — and it is the one
 * part the test suite can genuinely verify. The mock store never performs a
 * cross-site redirect, so no test here can prove the handshake works; keeping
 * the DECISION separate from the I/O means the part that can be tested, is.
 *
 * The caller does the lookups and passes in facts. This function does no I/O,
 * touches no cookies, and — critically — never sees a name.
 *
 * WHY THERE IS NO NAME IN `ResolveInput`
 * --------------------------------------
 * Member names are enumerable via `GET /api/members`. Linking a provider
 * identity to an existing member because the names match would be account
 * takeover by anyone who can read that list, which is everyone. WS#3
 * (2026-06-03) already closed one hole of exactly this shape. Leaving the name
 * out of the input type makes that unforgettable rather than merely intended:
 * you cannot resolve by a field the function was never given.
 */

export interface ResolveInput {
  /** memberId from `identities[<provider>:<sub>]`, or null if this identity is new. */
  existingIdentityMemberId: string | null;
  /** memberId from a valid `member_session` cookie on this browser, or null. */
  sessionMemberId: string | null;
  /** Email claimed by the provider's id_token, normalized, or null. */
  providerEmail: string | null;
  /** Whether the PROVIDER asserts it has verified that address. */
  providerEmailVerified: boolean;
  /**
   * memberId of the member holding `providerEmail` — but ONLY when that
   * member's own `emailVerified` is true. The caller must pass null otherwise;
   * an unverified address on our side is a claim, not proof.
   */
  memberIdByVerifiedEmail: string | null;
}

export type ResolveAction =
  | { kind: 'signin'; memberId: string }
  | { kind: 'link'; memberId: string }
  | { kind: 'new-account' };

export function resolveOAuthIdentity(input: ResolveInput): ResolveAction {
  // 1. We have seen this provider identity before. This OUTRANKS the browser
  //    session on purpose: signing into your own Google account on a friend's
  //    phone must sign you in as YOU, not graft your Google identity onto the
  //    member whose session happens to be open on that device.
  if (input.existingIdentityMemberId) {
    return { kind: 'signin', memberId: input.existingIdentityMemberId };
  }

  // 2. A new identity, and this browser is already authenticated as someone.
  //    This is the upgrade path the whole feature exists for: an existing
  //    PIN member signs in as themselves, taps "Connect Google", and the
  //    identity attaches to the member they already are. The member_session
  //    cookie is the proof — not a name, not an email.
  if (input.sessionMemberId) {
    return { kind: 'link', memberId: input.sessionMemberId };
  }

  // 3. A new identity on an anonymous browser, but the address is verified on
  //    BOTH sides. Both halves are required: the provider must assert it
  //    checked the address, and we must have mailed a link to it ourselves.
  //    With only one half this becomes "claim an account by typing its
  //    address", which is the takeover rule 4 exists to avoid.
  if (
    input.providerEmail &&
    input.providerEmailVerified &&
    input.memberIdByVerifiedEmail
  ) {
    return { kind: 'link', memberId: input.memberIdByVerifiedEmail };
  }

  // 4. Nothing links. Create a new account — and ask for a display name first,
  //    refusing any name that already belongs to someone.
  return { kind: 'new-account' };
}
