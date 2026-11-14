/**
 * WHICH CLUB DOES A BRAND-NEW ACCOUNT BELONG TO? None, at first.
 *
 * Both sign-up terminals, `POST /api/auth/signup` (email and password) and
 * `POST /api/auth/complete-signup` (the Apple, Google and email-code finish),
 * ask this before making a `Member`. Since docs/plans/one-way-in.md, step 5,
 * there are exactly two answers, and neither puts the account on a roster:
 *
 * - THROUGH A CLUB'S LINK (`door`). The account is made in no club and asks
 *   to join this one; only an organiser's yes adds it (`lib/joinRequests.ts`).
 *   The link arrives as `doorToken`, or as `inviteToken`, the field every
 *   sign-up form sent while one-time invites existed and a club's link shared
 *   their address (`/bpm/j/<token>`).
 * - CREATING A CLUB (`noGroup: true`). A real account, deliberately on no
 *   roster until `POST /api/groups` makes it the new club's organiser.
 *
 * Anything else refuses with the one `invite_not_found`: no link, a link that
 * does not resolve, a typed invite CODE (one-time invites were retired in step
 * 5; their codes resolve nothing), or two keys at once. Members only
 * (docs/plans/members-only.md): without a key, no account, or "a signed-out
 * visitor sees nothing" would protect nothing.
 *
 * THE CARRIER IS THE REQUEST BODY on both paths, on purpose: the OAuth stash is
 * written only for an installed PWA, so a plain browser would have nowhere to
 * park a link, and a body field is the same field in both terminals.
 *
 * Unknown, retired and closed links stay indistinguishable: the refusal never
 * says which, or sign-up becomes an oracle for which clubs exist.
 */
import type { NextRequest } from 'next/server';
import { isFlagOn } from '@/lib/flags';
import { resolveClaimLink } from '@/lib/claimLinks';

/** What a sign-up body may carry about where the account is going. */
export interface InviteFields {
  /** The club's link, as the forms have always sent it. */
  inviteToken?: unknown;
  /** A one-time invite's typed code. Retired: present means refused. */
  inviteCode?: unknown;
  /** "I am about to create my own club." Honoured only with groups on and no link. */
  noGroup?: unknown;
  /** The club's link, by its own name (docs/plans/one-way-in.md, step 4). */
  doorToken?: unknown;
}

export type SignupGroup =
  /** Through a club's link: an account on no roster that asks to join `door`. */
  | { ok: true; door: string }
  /** Creating a club: an account on no roster yet. */
  | { ok: true; door: null }
  | { ok: false };

const present = (v: unknown) => v !== undefined && v !== null;

/**
 * Where a new account is going. `_req` is kept for the callers' shape and for
 * a future club-scoped rule; nothing here reads the request's own club, which
 * is exactly the fallback this file exists to refuse.
 */
export async function signupGroupFor(_req: NextRequest, body: InviteFields): Promise<SignupGroup> {
  const groupsOn = isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');
  // PRESENT-BUT-INVALID IS NOT ABSENT: a field a client meant to send and sent
  // unusable (an empty string included) refuses, never falls through to
  // "no link" and makes an account somewhere it did not ask for.
  if (present(body.inviteCode)) return { ok: false };
  const links = [body.doorToken, body.inviteToken].filter(present);
  if (links.length > 1) return { ok: false };
  if (links.length === 1) {
    if (!groupsOn) return { ok: false };
    const door = await resolveClaimLink(links[0]);
    return door ? { ok: true, door } : { ok: false };
  }
  if (groupsOn && body.noGroup === true) return { ok: true, door: null };
  return { ok: false };
}
