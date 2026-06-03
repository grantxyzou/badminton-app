import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer, getActiveSessionId } from '@/lib/cosmos';
import { isAdminAuthed } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import type { GameResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

let ready: Promise<void> | null = null;
function ensureGames(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('gameResults', '/sessionId').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

function names(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw.map((n) => (typeof n === 'string' ? n.trim().slice(0, 50) : '')).filter(Boolean);
  return out.length > 0 ? out : null;
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGames();
    // sessionId override is admin-only (rule 7); non-admins read the active session.
    const override = new URL(req.url).searchParams.get('sessionId');
    const sessionId = override && isAdminAuthed(req) ? override : await getActiveSessionId();
    const container = getContainer('gameResults');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.sessionId = @sessionId',
        parameters: [{ name: '@sessionId', value: sessionId }],
      })
      .fetchAll();
    // JS-side newest-first sort — mock store doesn't honor ORDER BY.
    resources.sort((a, b) => String(b.loggedAt).localeCompare(String(a.loggedAt)));
    return NextResponse.json({ games: resources });
  } catch (error) {
    console.error('GET games error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Rate limit before any work — same posture as the rest of the API.
  const ip = getClientIp(req);
  if (!checkRateLimit(`games:${ip}`, 30, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  try {
    await ensureGames();
    const body = await req.json();
    const teamA = names(body.teamA);
    const teamB = names(body.teamB);
    if (!teamA || !teamB) return NextResponse.json({ error: 'both_teams_required' }, { status: 400 });
    if (typeof body.scoreA !== 'number' || typeof body.scoreB !== 'number'
      || !Number.isFinite(body.scoreA) || !Number.isFinite(body.scoreB)) {
      return NextResponse.json({ error: 'numeric_scores_required' }, { status: 400 });
    }
    const loggedBy = typeof body.loggedBy === 'string' ? body.loggedBy.trim().slice(0, 50) : '';
    if (!loggedBy) return NextResponse.json({ error: 'loggedBy_required' }, { status: 400 });

    // sessionId override is admin-only (rule 7); non-admins log to the active session.
    const sessionId = typeof body.sessionId === 'string' && body.sessionId && isAdminAuthed(req)
      ? body.sessionId
      : await getActiveSessionId();

    const record: GameResult = {
      id: randomBytes(16).toString('hex'),
      sessionId,
      teamA,
      teamB,
      scoreA: Math.round(body.scoreA),
      scoreB: Math.round(body.scoreB),
      loggedBy,
      loggedAt: new Date().toISOString(),
    };
    const container = getContainer('gameResults');
    const { resource } = await container.items.create(record);
    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST games error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
