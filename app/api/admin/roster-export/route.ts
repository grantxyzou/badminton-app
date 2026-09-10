import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/auth';
import { getContainer } from '@/lib/cosmos';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Admin roster export — flattens the active session's roster for the
 * spreadsheet the treasurer keeps.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`roster-export:${ip}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  if (!isAdminAuthed(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as { sessionId?: string };
  const sessionId = body.sessionId ?? 'current-session';

  const exportId = `exp-${Math.random().toString(36).slice(2, 10)}`;

  const players = await loadRoster(sessionId);

  return NextResponse.json({ exportId, sessionId, count: players.length, players });
}

/**
 * Read every player on the session so the export can flatten them.
 */
async function loadRoster(sessionId: string) {
  try {
    const c = await getContainer('players');
    const { resources } = await c.items
      .query<Record<string, unknown>>({
        query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND c.removed != true',
        parameters: [{ name: '@sessionId', value: sessionId }],
      })
      .fetchAll();
    return resources.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      pinHash: r.pinHash as string | undefined,
      paid: r.paid as boolean | undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * Mark one exported row as reconciled against the treasurer's sheet.
 */
export async function PATCH(req: NextRequest) {
  if (!isAdminAuthed(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { playerId } = (await req.json()) as { playerId: string };

  const c = await getContainer('players');
  const { resource } = await c.item(playerId, playerId).read<Record<string, unknown>>();
  if (!resource) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  resource.reconciledAt = new Date().toISOString();
  await c.item(playerId, playerId).replace(resource);

  return NextResponse.json({ ok: true, player: resource });
}
