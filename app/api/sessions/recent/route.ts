import { NextRequest, NextResponse } from 'next/server';
import { getContainer, POINTER_ID } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { normalizeBirdUsages, totalBirdCost } from '@/lib/birdUsages';
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

    const summaries: RecentSessionSummary[] = await Promise.all(
      (sessions as Session[]).map(async (s) => {
        const sessionId = s.id;
        const { resources: players } = await playersContainer.items
          .query({
            query: 'SELECT c.paid, c.removed, c.waitlisted FROM c WHERE c.sessionId = @sessionId',
            parameters: [{ name: '@sessionId', value: sessionId }],
          })
          .fetchAll();

        const active = (players as Array<{ paid?: boolean; removed?: boolean; waitlisted?: boolean }>)
          .filter((p) => !p.removed && !p.waitlisted);
        const paidCount = active.filter((p) => p.paid === true).length;

        const courtTotal = (s.costPerCourt ?? 0) * (s.courts ?? 0);
        const birdTotal = totalBirdCost(normalizeBirdUsages(s));
        const totalCost = courtTotal + birdTotal;

        return {
          sessionId,
          date: s.datetime ?? '',
          attendanceCount: active.length,
          totalCost,
          paidPercent: active.length > 0 ? Math.round((paidCount / active.length) * 100) : 0,
          anomalyCodes: s.anomaliesAtAdvance ?? [],
        };
      })
    );

    return NextResponse.json(summaries);
  } catch (error) {
    console.error('GET /api/sessions/recent error:', error);
    return NextResponse.json({ error: 'Failed to fetch recent sessions' }, { status: 500 });
  }
}
