import { NextRequest, NextResponse } from 'next/server';
import { getContainer, POINTER_ID } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { sessionCostTotals } from '@/lib/sessionCost';
import type { Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 24;

interface RecentSessionSummary {
  sessionId: string;
  date: string;
  attendanceCount: number;
  totalCost: number;
  paidPercent: number;
  anomalyCodes: string[];
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  const params = new URL(req.url).searchParams;
  const requested = parseInt(params.get('limit') ?? '', 10);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requested) ? requested : DEFAULT_LIMIT));

  try {
    const sessionsContainer = getContainer('sessions');
    const playersContainer = getContainer('players');

    const { resources: allSessions } = await sessionsContainer.items
      .query({
        query: `SELECT * FROM c WHERE c.id != @pointerId AND c.id != @legacyId`,
        parameters: [
          { name: '@pointerId', value: POINTER_ID },
          { name: '@legacyId', value: 'current-session' },
        ],
      })
      .fetchAll();
    // Sort + limit in JS — Cosmos honors ORDER BY/LIMIT but the mock store doesn't.
    const sessions = (allSessions as Session[])
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, limit);

    // Single batched player fetch (was N+1 — one query per session inside
    // Promise.all). Real Cosmos honors IN(); the mock store ignores it and
    // returns every row, so we MUST post-filter by sessionIdSet — same contract
    // as admin/ledger and stats/attendance. Group by sessionId so each summary
    // counts only its own players.
    type PlayerRow = { sessionId: string; paid?: boolean; removed?: boolean; waitlisted?: boolean };
    const sessionIds = sessions.map((s) => s.id);
    const sessionIdSet = new Set(sessionIds);
    const playersBySession = new Map<string, PlayerRow[]>();

    if (sessionIds.length > 0) {
      const placeholders = sessionIds.map((_, i) => `@sid${i}`).join(',');
      const { resources: rawPlayers } = await playersContainer.items
        .query({
          query: `SELECT c.sessionId, c.paid, c.removed, c.waitlisted FROM c WHERE c.sessionId IN (${placeholders})`,
          parameters: sessionIds.map((id, i) => ({ name: `@sid${i}`, value: id })),
        })
        .fetchAll();
      for (const p of rawPlayers as PlayerRow[]) {
        if (!sessionIdSet.has(p.sessionId)) continue;
        const arr = playersBySession.get(p.sessionId);
        if (arr) arr.push(p);
        else playersBySession.set(p.sessionId, [p]);
      }
    }

    const summaries: RecentSessionSummary[] = (sessions as Session[]).map((s) => {
      const active = (playersBySession.get(s.id) ?? []).filter((p) => !p.removed && !p.waitlisted);
      const paidCount = active.filter((p) => p.paid === true).length;

      const { totalCost } = sessionCostTotals(s);

      return {
        sessionId: s.id,
        date: s.datetime ?? '',
        attendanceCount: active.length,
        totalCost,
        paidPercent: active.length > 0 ? Math.round((paidCount / active.length) * 100) : 0,
        anomalyCodes: s.anomaliesAtAdvance ?? [],
      };
    });

    return NextResponse.json(summaries);
  } catch (error) {
    console.error('GET /api/sessions/recent error:', error);
    return NextResponse.json({ error: 'Failed to fetch recent sessions' }, { status: 500 });
  }
}
