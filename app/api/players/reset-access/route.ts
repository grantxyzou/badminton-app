import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { issueCode } from '@/lib/recoveryCodes';
import { appendEvent } from '@/lib/recoveryAudit';
import { isFlagOn } from '@/lib/flags';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY')) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`reset-access:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  if (!isAdminAuthed(req)) return unauthorized();

  let body: { playerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (typeof body.playerId !== 'string' || !body.playerId) {
    return NextResponse.json({ error: 'Invalid playerId' }, { status: 400 });
  }

  const sessionId = await getActiveSessionId();
  const container = getContainer('players');
  const { resource: player } = await container.item(body.playerId, sessionId).read();
  if (!player) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }
  if (player.removed === true) {
    return NextResponse.json({ error: 'Restore the player first' }, { status: 409 });
  }

  const { code, expiresAt } = await issueCode(player.id, sessionId);

  const updatedEvents = appendEvent(player.recoveryEvents, {
    event: 'reset-access-issued',
    at: new Date().toISOString(),
    admin: 'admin',
  });
  await container.items.upsert({ ...player, recoveryEvents: updatedEvents });

  return NextResponse.json({ code, expiresAt });
}
