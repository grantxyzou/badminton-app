import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer, getActiveSessionId } from '@/lib/cosmos';
import { isAdminAuthed, isAdminAuthedWithMember, verifyMemberAuth } from '@/lib/auth';
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
    const params = new URL(req.url).searchParams;
    const container = getContainer('gameResults');

    // All-time read for one player: `?name=X&all=true`. The default stays
    // active-session-scoped so existing callers are unchanged.
    //
    // This exists because a "Games — logged" figure scoped to the current
    // session is a lying number: it reads as a career total and silently means
    // "this week". Requiring `name` keeps the widening narrow — an anonymous
    // caller gets one player's games, not a dump of the whole history.
    const all = params.get('all') === 'true';
    const rawName = params.get('name')?.trim().slice(0, 50) ?? '';
    if (all) {
      if (!rawName) {
        return NextResponse.json({ error: 'name_required' }, { status: 400 });
      }
      const { resources: every } = await container.items
        .query({ query: 'SELECT * FROM c' })
        .fetchAll();
      const needle = rawName.toLowerCase();
      // Games store player NAMES, never memberIds (see lib/levelStore.ts) — so
      // this join is name-based and case-insensitive, matching every other
      // name join in the app.
      const mine = (every as { teamA?: string[]; teamB?: string[] }[]).filter((g) =>
        [...(g.teamA ?? []), ...(g.teamB ?? [])].some(
          (n) => String(n).trim().toLowerCase() === needle,
        ),
      );
      mine.sort((a, b) =>
        String((b as { loggedAt?: string }).loggedAt).localeCompare(
          String((a as { loggedAt?: string }).loggedAt),
        ),
      );
      return NextResponse.json({ games: mine });
    }

    // sessionId override is admin-only (rule 7); non-admins read the active session.
    const override = params.get('sessionId');
    const sessionId = override && isAdminAuthed(req) ? override : await getActiveSessionId();
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
    // Games join on NAME, so one person on both teams is counted as both a win
    // and a loss for themselves — it corrupts every downstream record and
    // partner tally, and nothing else in the pipeline can detect it later.
    const inA = new Set(teamA.map((n) => n.toLowerCase()));
    if (teamB.some((n) => inA.has(n.toLowerCase()))) {
      return NextResponse.json({ error: 'overlapping_teams' }, { status: 400 });
    }
    if (typeof body.scoreA !== 'number' || typeof body.scoreB !== 'number'
      || !Number.isFinite(body.scoreA) || !Number.isFinite(body.scoreB)) {
      return NextResponse.json({ error: 'numeric_scores_required' }, { status: 400 });
    }
    // Game logging is identity-bound (rule 12): the recorder must hold the
    // member_session cookie (minted at sign-up, no PIN) or be an admin — never
    // name-only, since member names are enumerable via GET /api/members. Mirror
    // the gear endpoint's owner-or-admin pattern. The cookie name is the
    // authoritative `loggedBy`; admins may log on behalf of another name.
    const caller = verifyMemberAuth(req);
    let loggedBy: string;
    if (caller) {
      loggedBy = caller.name;
    } else if ((await isAdminAuthedWithMember(req)).authed) {
      loggedBy = typeof body.loggedBy === 'string' ? body.loggedBy.trim().slice(0, 50) : '';
      if (!loggedBy) return NextResponse.json({ error: 'loggedBy_required' }, { status: 400 });
    } else {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

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
