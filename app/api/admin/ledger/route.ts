import { NextRequest, NextResponse } from 'next/server';
import { getContainer, POINTER_ID } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import type { Player, Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/ledger?range=30d|12w|all
 *
 * Admin-only reconciliation read. Aggregates *settled* sessions in the window
 * into the cost ↔ payment ↔ spend triple:
 *
 *   collected (paid + covered) ──┐
 *                                ├─ gap = spent − collected
 *   spent (settled totalCost) ───┘
 *
 * Only sessions with a frozen `session.settled` snapshot are counted — the
 * gap reflects "bills already sent", so an admin reading $40 owing knows it
 * maps to receipts they actually issued, not live-recomputed estimates.
 *
 * Range presets (no custom picker by product decision — 3 chips, narrow→wide):
 *   30d  → last 30 days
 *   12w  → last 12 weeks (default)
 *   all  → everything
 *
 * `?from=/&to=` ISO params from the original spec were dropped: with fixed
 * presets there is no client date math, so the to>from / future / 730-day
 * validation surface disappears with it.
 */

type RangeKey = '30d' | '12w' | 'all';

function resolveFrom(range: RangeKey, now: number): number {
  if (range === 'all') return 0;
  if (range === '30d') return now - 30 * 86_400_000;
  return now - 84 * 86_400_000; // 12w
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface ByPlayerAcc {
  memberId: string | null;
  name: string;
  sessionCount: number;
  owedAmount: number;
}

export async function GET(req: NextRequest) {
  // Rate limit before auth so it can't be bypassed (CLAUDE.md security #4).
  const ip = getClientIp(req);
  if (!checkRateLimit(`ledger:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();

  const rawRange = req.nextUrl.searchParams.get('range');
  const range: RangeKey =
    rawRange === '30d' || rawRange === 'all' ? rawRange : '12w';

  try {
    const now = Date.now();
    const fromMs = resolveFrom(range, now);
    const fromIso = new Date(fromMs).toISOString();
    const toIso = new Date(now).toISOString();

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

    // Settled-only + in-window. Unsettled sessions are deliberately excluded
    // from spent + bySession so the gap reflects bills already frozen.
    const windowSessions = (allSessions as Session[])
      .filter((s) => {
        if (!s.settled) return false;
        if (!s.datetime) return false;
        const t = new Date(s.datetime).getTime();
        if (!Number.isFinite(t)) return false;
        return t >= fromMs && t <= now;
      })
      .sort((a, b) => (a.datetime! < b.datetime! ? 1 : -1));

    const emptyResponse = {
      range: { from: fromIso, to: toIso },
      summary: {
        spent: 0,
        paidAmount: 0,
        coveredAmount: 0,
        collected: 0,
        gap: 0,
        sessionCount: 0,
        coveredCount: 0,
      },
      bySession: [],
      byPlayer: [],
    };

    if (windowSessions.length === 0) {
      return NextResponse.json(emptyResponse);
    }

    const sessionIds = windowSessions.map((s) => s.id);
    const sessionIdSet = new Set(sessionIds);

    // Batch player fetch. Real Cosmos honors IN(); the mock store ignores it
    // and returns every player row — so we MUST post-filter by sessionIdSet
    // for the two stores to agree (same contract as stats/attendance).
    const placeholders = sessionIds.map((_, i) => `@sid${i}`).join(',');
    const { resources: rawPlayers } = await playersContainer.items
      .query({
        query: `SELECT * FROM c WHERE c.sessionId IN (${placeholders})`,
        parameters: sessionIds.map((id, i) => ({ name: `@sid${i}`, value: id })),
      })
      .fetchAll();
    const players = (rawPlayers as Player[]).filter((p) =>
      sessionIdSet.has(p.sessionId),
    );

    // ── Summary + bySession ──
    let spent = 0;
    let paidAmount = 0;
    let coveredAmount = 0;
    let coveredCount = 0;

    const playersBySession = new Map<string, Player[]>();
    for (const p of players) {
      const arr = playersBySession.get(p.sessionId);
      if (arr) arr.push(p);
      else playersBySession.set(p.sessionId, [p]);
    }

    const bySession = windowSessions.map((s) => {
      const snap = s.settled!;
      spent += snap.totalCost;
      const roster = playersBySession.get(s.id) ?? [];

      let paidCount = 0;
      let sessionCovered = 0;
      let unpaidCount = 0;
      let unpaidAmount = 0;

      for (const p of roster) {
        const owed = p.owedAmount ?? 0;
        const isPaid = p.paid === true;
        const isCovered = p.writtenOff === true;
        if (isPaid) {
          paidCount += 1;
          paidAmount += owed;
        } else if (isCovered) {
          // Permissive predicate: if a legacy/race record has both paid AND
          // writtenOff, it was counted as paid above — never double-counted.
          sessionCovered += 1;
          coveredCount += 1;
          coveredAmount += owed;
        } else if (owed > 0) {
          unpaidCount += 1;
          unpaidAmount += owed;
        }
      }

      return {
        sessionId: s.id,
        date: s.datetime!,
        // Frozen denominator — immune to later roster edits, unlike a live
        // count of player rows.
        attendanceCount: snap.playerCount,
        totalCost: round2(snap.totalCost),
        paidCount,
        coveredCount: sessionCovered,
        unpaidAmount: round2(unpaidAmount),
        unpaidCount,
      };
    });

    const collected = paidAmount + coveredAmount;

    // ── byPlayer: only players still owing ──
    // Keyed by case-insensitive name, NOT memberId. Per spec: a migrated
    // record (has memberId) and its same-name legacy twin (no memberId) must
    // collapse into one row. memberId-keying would split them; name-keying
    // unifies. Same-name-different-person is punted to Stage-2 `orgId` scope.
    const byPlayerMap = new Map<string, ByPlayerAcc>();
    for (const p of players) {
      const owed = p.owedAmount ?? 0;
      const stillOwes = owed > 0 && p.paid !== true && p.writtenOff !== true;
      if (!stillOwes) continue;
      const key = p.name.toLowerCase();
      const existing = byPlayerMap.get(key);
      if (existing) {
        existing.sessionCount += 1;
        existing.owedAmount += owed;
        // Keep the first non-null memberId so the sub-issue D drill-in can
        // open a profile even when a legacy row sorts first.
        if (existing.memberId === null && p.memberId) {
          existing.memberId = p.memberId;
        }
      } else {
        byPlayerMap.set(key, {
          memberId: p.memberId ?? null,
          name: p.name,
          sessionCount: 1,
          owedAmount: owed,
        });
      }
    }

    const byPlayer = Array.from(byPlayerMap.values())
      .map((r) => ({ ...r, owedAmount: round2(r.owedAmount) }))
      .sort((a, b) => b.owedAmount - a.owedAmount);

    return NextResponse.json({
      range: { from: fromIso, to: toIso },
      summary: {
        spent: round2(spent),
        paidAmount: round2(paidAmount),
        coveredAmount: round2(coveredAmount),
        collected: round2(collected),
        gap: round2(spent - collected),
        sessionCount: windowSessions.length,
        coveredCount,
      },
      bySession,
      byPlayer,
    });
  } catch (error) {
    console.error('GET /api/admin/ledger error:', error);
    return NextResponse.json(
      { error: 'Failed to compute ledger' },
      { status: 500 },
    );
  }
}
