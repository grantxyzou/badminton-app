import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

/**
 * Admin roster export — the active session's players, for pasting into a message.
 */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`roster-export:${ip}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();

  const sessionId = await getActiveSessionId();
  const players = getContainer('players');

  try {
    const { resources } = await players.items
      .query({
        query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed = false)',
        parameters: [{ name: '@sessionId', value: sessionId }],
      })
      .fetchAll();
    return NextResponse.json(resources);
  } catch {
    return NextResponse.json([]);
  }
}

/** Mark the roster as exported, so the admin can see it has been sent once. */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`roster-export-post:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();

  const { sessionId } = await req.json();
  const sessions = getContainer('sessions');
  const { resource } = await sessions.item(sessionId, sessionId).read();
  await sessions.items.upsert({ ...resource, rosterExportedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
