import { NextRequest, NextResponse } from 'next/server';
import { getContainer, POINTER_ID, getActiveSessionId } from '@/lib/cosmos';
import { sessionCostTotals } from '@/lib/sessionCost';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import type { Player, Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/players/unpaid?name=<name>
 *
 * A player's own "what do I still owe" view, used by the Profile
 * outstanding-payments card and the Home balance card. Public-by-name (same
 * posture as `/api/stats/attendance`) — no auth, rate-limited by IP so it can't
 * be scraped wholesale.
 *
 * A player owes for a PAST session they attended and that isn't paid/written
 * off (`paid !== true && writtenOff !== true`). Two ways the amount is known:
 *   1. SETTLED sessions — use the frozen `owedAmount` stamped at settle time
 *      (only counts when `> 0`).
 *   2. UNSETTLED past sessions — the admin never ran settle, so there's no
 *      frozen amount; compute the live per-person share `totalCost / active
 *      roster`. This matches the friend-group mental model ("owed = whoever
 *      didn't get marked paid") rather than requiring the settle step, which
 *      most past sessions never had. Unpriced sessions contribute 0.
 *
 * The active session is never counted via the live path (its bill isn't due
 * yet — it may not have happened), but a settled debt on it is real and counts.
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
    const activeSessionId = await getActiveSessionId();
    const now = Date.now();

    const { resources: allSessions } = await sessionsContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id != @pointerId AND c.id != @legacyId',
        parameters: [
          { name: '@pointerId', value: POINTER_ID },
          { name: '@legacyId', value: 'current-session' },
        ],
      })
      .fetchAll();

    // Two buckets, mutually exclusive on `session.settled`:
    //  - settled: amount is frozen on each player.
    //  - unsettled & past & not the active session: compute the live share.
    // Excluding the active session uses its id, NOT datetime — this week's game
    // may already be underway (datetime < now) but not yet advanced/billed.
    const settledSessions = (allSessions as Session[]).filter(
      (s) => s.settled && typeof s.datetime === 'string',
    );
    const unsettledPast = (allSessions as Session[]).filter(
      (s) =>
        !s.settled &&
        typeof s.datetime === 'string' &&
        s.id !== activeSessionId &&
        new Date(s.datetime!).getTime() < now,
    );

    const relevant = [...settledSessions, ...unsettledPast];
    if (relevant.length === 0) {
      return NextResponse.json(EMPTY);
    }

    const dateBySession = new Map<string, string>();
    for (const s of relevant) dateBySession.set(s.id, s.datetime!);
    const settledIdSet = new Set(settledSessions.map((s) => s.id));
    const unsettledIdSet = new Set(unsettledPast.map((s) => s.id));
    const sessionIds = relevant.map((s) => s.id);
    const sessionIdSet = new Set(sessionIds);

    // Frozen group total for each unsettled session (for the live per-person share).
    const totalCostBySession = new Map<string, number>();
    for (const s of unsettledPast) totalCostBySession.set(s.id, sessionCostTotals(s).totalCost);

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
    const players = (rawPlayers as Player[]).filter((p) => sessionIdSet.has(p.sessionId));

    // Active-roster size per unsettled session = the live per-person denominator.
    // Count the FULL active roster (everyone non-removed, non-waitlisted),
    // independent of who's asking — so the share is right regardless of how many
    // have paid.
    const activeCountBySession = new Map<string, number>();
    for (const p of players) {
      if (!unsettledIdSet.has(p.sessionId)) continue;
      if (p.removed === true || p.waitlisted === true) continue;
      activeCountBySession.set(p.sessionId, (activeCountBySession.get(p.sessionId) ?? 0) + 1);
    }

    const lowerName = name.toLowerCase();
    const unpaid: UnpaidSession[] = [];
    for (const p of players) {
      if (typeof p.name !== 'string' || p.name.toLowerCase() !== lowerName) continue;
      // "Still owes" base predicate — mirrors the admin ledger.
      if (p.paid === true || p.writtenOff === true) continue;
      const date = dateBySession.get(p.sessionId);
      if (!date) continue;

      if (settledIdSet.has(p.sessionId)) {
        // Settled: use the frozen amount (never the live compute — that would
        // double-count and could disagree with what the player was billed).
        const owed = p.owedAmount ?? 0;
        if (owed > 0) unpaid.push({ sessionId: p.sessionId, date, owedAmount: round2(owed) });
      } else {
        // Unsettled past: live per-person share. Skip removed/waitlisted (not on
        // the hook) and unpriced sessions (no amount to owe).
        if (p.removed === true || p.waitlisted === true) continue;
        const totalCost = totalCostBySession.get(p.sessionId) ?? 0;
        const activeCount = activeCountBySession.get(p.sessionId) ?? 0;
        if (totalCost > 0 && activeCount > 0) {
          unpaid.push({ sessionId: p.sessionId, date, owedAmount: round2(totalCost / activeCount) });
        }
      }
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
