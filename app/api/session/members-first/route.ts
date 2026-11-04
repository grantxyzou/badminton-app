import { NextRequest, NextResponse } from 'next/server';
import { getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId, noActiveSession } from '@/lib/groupContext';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { membersFirstUntil } from '@/lib/membersFirst';
import { releaseMembersFirst } from '@/lib/waitlistPromote';
import type { Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * "Let the waitlist in now" (docs/plans/members-first-window.md, Q3): the
 * organiser ends this session's members-first window early. Nothing runs on
 * a timer, so the window otherwise ends on the first visit after it; this is
 * for the day the organiser does not want to wait, or nobody opens the app.
 *
 * The same release the visits run: stamp the session under its etag, then
 * move the waitlist up in sign-up order with a push to each person.
 *
 * 200 `{ released, membersFirstReleasedAt }`; 409 `no_window` when the session
 * has none, or `session_started` once nothing can move.
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    const scope = groupScope(resolveGroupId(req));
    const sessionId = await getActiveSessionId(scope.groupId);
    if (!sessionId) return noActiveSession();
    const session = await scope.read<Session & { id: string }>('sessions', sessionId, sessionId);
    if (!session || membersFirstUntil(session) === null) {
      return NextResponse.json({ error: 'no_window' }, { status: 409 });
    }
    if (session.membersFirstReleasedAt) {
      return NextResponse.json({ released: false, membersFirstReleasedAt: session.membersFirstReleasedAt });
    }
    const start = Date.parse(session.datetime);
    if (session.settled || !Number.isFinite(start) || Date.now() >= start) {
      return NextResponse.json({ error: 'session_started' }, { status: 409 });
    }
    const released = await releaseMembersFirst(scope, sessionId, { force: true, session });
    const after = await scope.read<Session & { id: string }>('sessions', sessionId, sessionId);
    if (!after?.membersFirstReleasedAt) {
      return NextResponse.json({ error: 'release_failed' }, { status: 503 });
    }
    return NextResponse.json({ released, membersFirstReleasedAt: after.membersFirstReleasedAt });
  } catch (error) {
    console.error('POST /api/session/members-first error:', error);
    return NextResponse.json({ error: 'release_failed' }, { status: 503 });
  }
}
