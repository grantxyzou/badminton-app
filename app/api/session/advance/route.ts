import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId, setActiveSessionId, sessionIdFromDate } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { toValidIso } from '@/app/api/session/route';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const body = await req.json();
    const datetime = toValidIso(body.datetime);
    if (!datetime) {
      return NextResponse.json({ error: 'datetime required' }, { status: 400 });
    }

    const newId = sessionIdFromDate(datetime);
    const currentId = await getActiveSessionId();

    if (newId === currentId) {
      return NextResponse.json({ error: 'Session already active for this date' }, { status: 409 });
    }

    const container = getContainer('sessions');
    const { resources: currentSessions } = await container.items
      .query({ query: 'SELECT * FROM c WHERE c.id = @id', parameters: [{ name: '@id', value: currentId }] })
      .fetchAll();
    const currentSession = currentSessions[0];

    const newSession = {
      id: newId,
      sessionId: newId,
      title: String(body.title ?? '').trim().slice(0, 100) || 'Weekly Badminton Session',
      locationName: String(body.locationName ?? '').trim().slice(0, 200),
      locationAddress: String(body.locationAddress ?? '').trim().slice(0, 300),
      datetime,
      endDatetime: toValidIso(body.endDatetime),
      deadline: toValidIso(body.deadline),
      courts: Math.max(1, Math.min(20, parseInt(body.courts, 10) || 2)),
      maxPlayers: Math.max(1, Math.min(100, parseInt(body.maxPlayers, 10) || 12)),
      signupOpen: false,
    };

    await container.items.upsert(newSession);
    await setActiveSessionId(newId);

    return NextResponse.json(newSession, { status: 201 });
  } catch (error) {
    console.error('POST advance error:', error);
    return NextResponse.json({ error: 'Failed to advance session' }, { status: 500 });
  }
}
