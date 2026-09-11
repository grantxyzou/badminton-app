/**
 * WHICH CLUB DOES A BRAND-NEW ACCOUNT BELONG TO?
 *
 * Both signup terminals — `POST /api/auth/signup` (email + password) and
 * `POST /api/auth/complete-signup` (the Google/Apple new-account finish) —
 * create a `Member` and, with groups on, join it to a group. Both resolved
 * that group with `resolveGroupId(req)`, which answers BPM for a request
 * carrying no claim. That is right for someone signing up at the front door
 * and WRONG for the case this file exists for: a stranger who followed an
 * invite link to another club has no cookie, so they were being written onto
 * BPM's roster on their way to somewhere else. The club they were invited to
 * was then added on top by `POST /api/groups/join`, leaving one person on two
 * rosters, one of which nobody asked for.
 *
 * So the invite travels WITH the signup. One helper and two callers rather
 * than a rule in each, because this repo has been bitten by the other
 * arrangement: `app/api/session/advance/route.ts` kept its own copy of the
 * settings-drift comparisons and a rule added to the shared function never
 * reached the code that runs.
 *
 * THE CARRIER IS THE REQUEST BODY, on both paths, on purpose. The obvious
 * alternative for OAuth is to park the group server-side the way
 * `HandoffDoc.groupId` does — but that stash is only written when an installed
 * PWA sends `?hr=`, so a plain browser has nowhere to park and the two
 * providers would need different mechanisms. A body field is the same field in
 * both terminals and is testable without an OAuth round trip.
 *
 * A TOKEN THAT DOES NOT RESOLVE IS A REFUSAL, NOT A FALLBACK. Falling back to
 * `resolveGroupId(req)` on a bad token would re-create the exact defect above,
 * quietly, for the person least able to notice. And the refusal says only
 * `invite_not_found`, matching `resolveInvite`'s one-null-for-everything rule:
 * unknown, retired and closed must stay indistinguishable, or signup becomes an
 * oracle for which clubs exist.
 */
import type { NextRequest } from 'next/server';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { resolveInvite } from '@/lib/invites';

/** The two shapes an invite arrives as, mirroring `POST /api/groups/join`. */
export interface InviteFields {
  inviteToken?: unknown;
  inviteCode?: unknown;
}

export type SignupGroup =
  /** `invited` is false for an ordinary front-door signup. */
  | { ok: true; groupId: string; invited: boolean }
  | { ok: false };

/** A trimmed string of a plausible length, or null. Same bounds as join's. */
function clean(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length >= 1 && trimmed.length <= max ? trimmed : null;
}

/**
 * The group a signup should join, given whatever invite the body carried.
 *
 * Flag OFF this is `resolveGroupId(req)` and nothing else — there is one club,
 * the invite surface 404s, and a token in the body means a client talking to a
 * deployment that does not have the feature. Ignoring it rather than refusing
 * keeps the flag-off path byte-identical to what shipped.
 */
export async function signupGroupFor(req: NextRequest, body: InviteFields): Promise<SignupGroup> {
  const requestGroup = resolveGroupId(req);
  if (!isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) {
    return { ok: true, groupId: requestGroup, invited: false };
  }

  // PRESENT-BUT-INVALID IS NOT ABSENT. `clean` answers `null` for both, and
  // collapsing them here would reinstate the fallback this file exists to
  // remove: a non-string or over-long `inviteToken` would read as "no invite
  // was sent" and join the request's own group. That is the unknown-is-not-
  // known-false rule, and it is the only branch where getting it wrong is
  // SILENT — the caller asked to join a club and lands somewhere else at 201.
  //
  // `undefined` and `null` are the two honest spellings of absent: a client
  // writing `{ inviteToken: token ?? null }` means "no invite", and refusing
  // that would break an ordinary front-door signup. Anything else is a client
  // that meant to send one and sent something unusable.
  //
  // THE EMPTY STRING IS DELIBERATELY NOT ABSENT, and the caller is the one that
  // has to know it (pinned by "refuses an EMPTY-STRING token"). It is the
  // tempting third spelling — `searchParams.get('join') ?? ''` and an untouched
  // controlled input both produce it — and forgiving it here would mean this
  // function could no longer tell a blank invite field from no invite field,
  // which is the distinction the whole file turns on. A signup form must send
  // `undefined`, never `''`.
  const attempted =
    (body.inviteToken !== undefined && body.inviteToken !== null) ||
    (body.inviteCode !== undefined && body.inviteCode !== null);

  const token = clean(body.inviteToken, 128);
  const code = clean(body.inviteCode, 64);
  // Both at once is a malformed request, not a choice to make for the caller —
  // `POST /api/groups/join` refuses the same shape for the same reason.
  if (token && code) return { ok: false };
  if (!token && !code) {
    return attempted ? { ok: false } : { ok: true, groupId: requestGroup, invited: false };
  }

  const groupId = token
    ? await resolveInvite(token, 'invite')
    : await resolveInvite(code!, 'code');
  if (!groupId) return { ok: false };
  return { ok: true, groupId, invited: true };
}
