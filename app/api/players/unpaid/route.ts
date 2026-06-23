import { NextRequest, NextResponse } from 'next/server';
import { getContainer, POINTER_ID } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import type { Player, Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/players/unpaid?name=<name>
 *
 * A player's own "what do I still owe" view, for the Profile outstanding-payments
 * card. Public-by-name (same posture as `/api/stats/attendance` and the existing
 * Profile "this week" cost row) — no auth, rate-limited by IP so it can't be
 * scraped wholesale.
 *
 * Only counts SETTLED sessions where the player still owes — `owedAmount > 0`,
 * not `paid`, not `writtenOff` — mirroring the admin ledger's `stillOwes`
 * predicate so the two never disagree.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface UnpaidSession {
  sessionId: string;
  date: string;
  owedAmount: number;
}

const EMPTY = {
  totalOwed: 0,
  sessionCount: 0,
  mostRecent: null as UnpaidSession | null,
  sessions: [] as UnpaidSession[],
};

export async function GET(req: NextRequest) {
  // Rate limit before anything else (CLAUDE.md security #4).
  const ip = getClientIp(req);
  if (!checkRateLimit(`unpaid:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const name = req.nextUrl.searchParams.get('name')?.trim();
  if (!name) {
    return NextResponse.json(EMPTY);
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

    // Settled-only + has a datetime. Owed amounts are only frozen at settle, so
    // unsettled sessions can't contribute an "outstanding" line.
    const settledSessions = (allSessions as Session[]).filter(
      (s) => s.settled && typeof s.datetime === 'string',
    );
    if (settledSessions.length === 0) {
      return NextResponse.json(EMPTY);
    }

    const dateBySession = new Map<string, string>();
    for (const s of settledSessions) dateBySession.set(s.id, s.datetime!);
    const sessionIds = settledSessions.map((s) => s.id);
    const sessionIdSet = new Set(sessionIds);

    // Batch fetch. Real Cosmos honors IN(); the mock store ignores it and
    // returns every row — so we post-filter by the session set for parity
    // (same contract as stats/attendance + admin/ledger).
    const placeholders = sessionIds.map((_, i) => `@sid${i}`).join(',');
    const { resources: rawPlayers } = await playersContainer.items
      .query({
        query: `SELECT * FROM c WHERE c.sessionId IN (${placeholders})`,
        parameters: sessionIds.map((id, i) => ({ name: `@sid${i}`, value: id })),
      })
      .fetchAll();

    const lowerName = name.toLowerCase();
    const unpaid: UnpaidSession[] = [];
    for (const p of rawPlayers as Player[]) {
      if (!sessionIdSet.has(p.sessionId)) continue;
      if (typeof p.name !== 'string' || p.name.toLowerCase() !== lowerName) continue;
      const owed = p.owedAmount ?? 0;
      const stillOwes = owed > 0 && p.paid !== true && p.writtenOff !== true;
      if (!stillOwes) continue;
      const date = dateBySession.get(p.sessionId);
      if (!date) continue;
      unpaid.push({ sessionId: p.sessionId, date, owedAmount: round2(owed) });
    }

    // Newest first.
    unpaid.sort((a, b) => (a.date < b.date ? 1 : -1));
    const totalOwed = round2(unpaid.reduce((sum, s) => sum + s.owedAmount, 0));

    return NextResponse.json({
      totalOwed,
      sessionCount: unpaid.length,
      mostRecent: unpaid[0] ?? null,
      sessions: unpaid,
    });
  } catch (error) {
    console.error('GET /api/players/unpaid error:', error);
    return NextResponse.json({ error: 'Failed to load unpaid sessions' }, { status: 500 });
  }
}
