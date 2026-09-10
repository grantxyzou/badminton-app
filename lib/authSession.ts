/**
 * The single terminus every sign-in path funnels through — PIN, password,
 * Google, Apple.
 *
 * This logic began as a local `syncAdminCookie` inside
 * `app/api/players/recover/route.ts`. It moved here BEFORE any new sign-in path
 * was added, because its second branch is not optional: a non-admin signing in
 * must CLEAR any existing `admin_session`, or admin powers persist across
 * sign-out → sign-in-as-a-different-player on a shared device. A new provider
 * callback that forgot that branch would silently re-open the hole, and an
 * omission is invisible in review — a missing *call* is at least greppable.
 *
 * THE GROUP (multi-group Phase 2): both cookies are minted FOR `groupId`, and
 * this is where the claim is verified — once, at mint. Flag off, `Member.role`
 * decides admin exactly as it always has. Flag on, the membership IN THAT
 * GROUP decides: owner or admin there gets an `admin_session`, anyone else —
 * a `Member.role` admin with no membership included — gets the clear. Reading
 * the membership here rather than at the twelve call sites is the same
 * argument as the clear branch: a call site that forgot would mint admin
 * powers in a group the person has no standing in. Async for that read.
 *
 * ORDERING IS LOAD-BEARING: `clearAdminCookie` appends raw `Set-Cookie` headers
 * by hand (see the comment on `appendClearCookie` in lib/auth.ts), while
 * `res.cookies.set` re-serializes the entire cookie map and would drop those
 * appended headers. So never call a `set*` helper AFTER a `clear*` on the same
 * response — the member cookie is set FIRST here for exactly that reason.
 */
import { NextResponse } from 'next/server';
import { setMemberCookie, setAdminCookie, clearAdminCookie } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { readGroupAdmin } from '@/lib/groups';

export async function completeSignIn(
  res: NextResponse,
  member: { id: string; name: string; role?: string },
  groupId: string,
): Promise<void> {
  setMemberCookie(res, member.id, member.name, groupId);
  if (await isGroupAdmin(member, groupId)) {
    setAdminCookie(res, member.id, member.name, groupId);
  } else {
    clearAdminCookie(res);
  }
}

async function isGroupAdmin(member: { id: string; role?: string }, groupId: string): Promise<boolean> {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) return member.role === 'admin';
  try {
    return (await readGroupAdmin(groupId, member.id)) !== undefined;
  } catch {
    // A read that fails must not mint admin; the member cookie already stands.
    return false;
  }
}
