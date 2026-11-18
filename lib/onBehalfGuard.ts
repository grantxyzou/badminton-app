import { NextResponse } from 'next/server';
import { isFlagOn } from './flags';
import { GROUP_ADMIN_ROLES, listMembershipsForMember } from './groups';

/**
 * MAY AN ADMIN OPEN SOMEONE ELSE'S ACCOUNT? (Claude Security scan, 2026-11-17,
 * F1–F4.)
 *
 * Setting a PIN, clearing one, issuing a recovery code and approving a "let
 * me in" ask each hand a way into an ACCOUNT, and an account is the person:
 * their rank here, and their standing in every other club they belong to.
 * Six doors did this on a club admin's word alone, so an admin could become
 * the club's organiser, and anyone who made a club of their own could reach
 * a member's place in BPM once that member joined it.
 *
 * The rule, in one place so no route carries a copy:
 * - Your own account is yours.
 * - Groups off, there is one club and every admin is its organiser.
 * - Someone ACTIVE on another club's roster is refused (`other_club`): one
 *   club's admin cannot vouch for a person in a club they do not run. Such a
 *   person gets back in on their own, with an email code, Apple or Google.
 * - Someone holding a rank here (organiser or admin) is an organiser's call
 *   (`organiser_only`), the rule `reset-access` already had.
 *
 * A removed or departed membership elsewhere does not count: it signs nobody
 * in anywhere.
 */
export type OnBehalfRefusal = 'organiser_only' | 'other_club';

export interface OnBehalfCaller {
  memberId: string;
  groupId: string;
  organiser: boolean;
}

export async function onBehalfRefusal(admin: OnBehalfCaller, targetId: string): Promise<OnBehalfRefusal | null> {
  if (targetId === admin.memberId) return null;
  if (!isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) return null;
  // Filtered in JS as well as by the query: the mock store applies no WHERE.
  const live = (await listMembershipsForMember(targetId)).filter((m) => m.status === 'active');
  if (live.some((m) => m.groupId !== admin.groupId)) return 'other_club';
  const here = live.find((m) => m.groupId === admin.groupId);
  if (here && GROUP_ADMIN_ROLES.has(here.role) && !admin.organiser) return 'organiser_only';
  return null;
}

export function onBehalfRefused(refusal: OnBehalfRefusal): NextResponse {
  return NextResponse.json({ error: refusal }, { status: 403 });
}
