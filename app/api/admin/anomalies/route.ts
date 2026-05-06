import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId, POINTER_ID } from '@/lib/cosmos';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { evaluateAnomalies } from '@/lib/anomalies';
import type { Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  try {
    const sessionId = await getActiveSessionId();
    const sessionsContainer = getContainer('sessions');
    const membersContainer = getContainer('members');

    const [{ resources: currentList }, { resource: adminMember }, { resources: allSessions }] = await Promise.all([
      sessionsContainer.items
        .query({ query: 'SELECT * FROM c WHERE c.id = @id', parameters: [{ name: '@id', value: sessionId }] })
        .fetchAll(),
      membersContainer.item(auth.memberId, auth.memberId).read(),
      sessionsContainer.items.query({ query: 'SELECT * FROM c' }).fetchAll(),
    ]);

    const session = currentList[0] as Session | undefined;
    if (!session) return NextResponse.json([]);

    // Most recent archived session that isn't the active one or the pointer/legacy doc.
    const previousSession = (allSessions as Session[])
      .filter((s) => s.id !== POINTER_ID && s.id !== 'current-session' && s.id !== sessionId)
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0];

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
