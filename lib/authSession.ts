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
 * ORDERING IS LOAD-BEARING: `clearAdminCookie` appends raw `Set-Cookie` headers
 * by hand (see the comment on `appendClearCookie` in lib/auth.ts), while
 * `res.cookies.set` re-serializes the entire cookie map and would drop those
 * appended headers. So never call a `set*` helper AFTER a `clear*` on the same
 * response — the member cookie is set FIRST here for exactly that reason.
 */
import { NextResponse } from 'next/server';
import { setMemberCookie, setAdminCookie, clearAdminCookie } from '@/lib/auth';

export function completeSignIn(
  res: NextResponse,
  member: { id: string; name: string; role?: string },
): void {
  setMemberCookie(res, member.id, member.name);
  if (member.role === 'admin') {
    setAdminCookie(res, member.id, member.name);
  } else {
    clearAdminCookie(res);
  }
}
