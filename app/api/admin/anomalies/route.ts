import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { evaluateAnomalies } from '@/lib/anomalies';
import type { Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  try {
    const scope = groupScope(resolveGroupId(req));
    const sessionId = await getActiveSessionId(scope.groupId);
    // No session yet means no anomalies yet — the same empty list this route
    // already returns when the pointer targets a doc that does not exist.
    if (!sessionId) return NextResponse.json([]);
    const membersContainer = getContainer('members');

    const [session, { resource: adminMember }, archived] = await Promise.all([
      scope.read<Session>('sessions', sessionId, sessionId),
      membersContainer.item(auth.memberId, auth.memberId).read(),
      // The group's sessions minus the active one; the accessor drops the
      // pointer and legacy docs.
      scope.query<Session>('sessions', {
        where: 'c.id != @activeId',
        params: [{ name: '@activeId', value: sessionId }],
      }),
    ]);

    if (!session) return NextResponse.json([]);

    // Most recent archived session.
    const previousSession = archived.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];

    const anomalies = evaluateAnomalies({
      session,
      prevSnapshot: session.prevSnapshot,
      prevSessionDatetime: previousSession?.datetime,
      skipDates: (adminMember as { skipDates?: string[] } | undefined)?.skipDates,
      dismissed: session.anomaliesDismissed ?? [],
    });

    return NextResponse.json(anomalies);
  } catch (error) {
    console.error('GET /api/admin/anomalies error:', error);
    return NextResponse.json({ error: 'Failed to evaluate anomalies' }, { status: 500 });
  }
}
