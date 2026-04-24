import { NextRequest, NextResponse } from 'next/server';
import { getContainer, POINTER_ID } from '@/lib/cosmos';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stats/attendance?name=<player-name>[&weeks=12]
 *
 * Returns the player's attendance over the last N weeks. Open to any visitor
 * — no auth required. We only read session-scoped player rows by name, and
 * the response contains no sensitive data (no tokens, no email).
 *
 * Response shape:
 *   {
 *     name: string,
 *     weeks: number,
 *     attended: number,        // count of sessions in window where they played
 *     streak: number,          // consecutive most-recent sessions played
 *     longestStreak: number,   // best run across the window
 *     history: [                // one entry per session in window, newest first
 *       { sessionId, datetime, attended }
 *     ]
 *   }
 *
 * "Attended" = player row exists for that session with removed !== true and
 * waitlisted !== true. Promoted-from-waitlist counts as attendance.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const name = url.searchParams.get('name')?.trim();
  const weeksParam = Number(url.searchParams.get('weeks') ?? '12');
  // Allow up to 5 years of history for the year-zoom heatmap. Clamp to 260.
  const weeks = Number.isFinite(weeksParam) && weeksParam > 0 && weeksParam <= 260 ? Math.floor(weeksParam) : 12;

  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }

  try {
    const sessionsContainer = getContainer('sessions');
    const playersContainer = getContainer('players');

    const { resources: allSessions } = await sessionsContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id != @pointerId AND c.id != @legacyId',
        parameters: [
          { name: '@pointerId', value: POINTER_ID },
          { name: '@legacyId', value: 'current-session' },
        ],
      })
      .fetchAll();

    // Sort by datetime descending (most recent first). Sessions without a
    // datetime sink to the bottom.
    const sorted = (allSessions as Array<{ id: string; datetime?: string }>).slice().sort((a, b) => {
      const da = a.datetime ?? '';
      const db = b.datetime ?? '';
      if (da === db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return db.localeCompare(da);
    });

    const windowSessions = sorted.slice(0, weeks);
    if (windowSessions.length === 0) {
      return NextResponse.json({
        name,
        weeks,
        attended: 0,
        streak: 0,
        longestStreak: 0,
        history: [],
      });
    }

    // Case-insensitive name match against `players` rows for each session.
    // Batch into one query filtered by sessionIds to avoid N roundtrips.
    const sessionIds = windowSessions.map((s) => s.id);
    const placeholders = sessionIds.map((_, i) => `@sid${i}`).join(',');
    const { resources: playerRows } = await playersContainer.items
      .query({
        query: `SELECT c.sessionId, c.name, c.removed, c.waitlisted FROM c WHERE c.sessionId IN (${placeholders}) AND LOWER(c.name) = LOWER(@name)`,
        parameters: [
          { name: '@name', value: name },
          ...sessionIds.map((id, i) => ({ name: `@sid${i}`, value: id })),
        ],
      })
      .fetchAll();

    const attendedBySession = new Map<string, boolean>();
    for (const row of playerRows as Array<{ sessionId: string; removed?: boolean; waitlisted?: boolean }>) {
      if (row.removed === true) continue;
      if (row.waitlisted === true) continue;
      attendedBySession.set(row.sessionId, true);
    }

    const history = windowSessions.map((s) => ({
      sessionId: s.id,
      datetime: s.datetime ?? null,
      attended: attendedBySession.has(s.id),
    }));

    const attended = history.filter((h) => h.attended).length;

    // Current streak = consecutive attended sessions starting from most-recent.
    let streak = 0;
    for (const h of history) {
      if (h.attended) streak += 1;
      else break;
    }

    // Longest streak across the window.
    let longestStreak = 0;
    let run = 0;
    for (const h of history) {
      if (h.attended) {
        run += 1;
        if (run > longestStreak) longestStreak = run;
      } else {
        run = 0;
      }
    }

    return NextResponse.json({
      name,
      weeks,
      attended,
      streak,
      longestStreak,
      history,
    });
  } catch (error) {
    console.error('GET /api/stats/attendance error:', error);
    return NextResponse.json({ error: 'Failed to compute attendance' }, { status: 500 });
  }
}
