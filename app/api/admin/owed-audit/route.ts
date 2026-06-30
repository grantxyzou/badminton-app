import { NextRequest, NextResponse } from 'next/server';
import { getContainer, POINTER_ID, getActiveSessionId } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveIdentity, matchesIdentity, classifyOwed, type OwedReason } from '@/lib/playerIdentity';
import type { Player, Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/owed-audit?name=<name>  (or ?memberId=<id>)
 *
 * Admin diagnostic: explains, per session, why a player's "what you owe" total
 * is what it is. Resolves identity the SAME way `/api/players/unpaid` does
 * (memberId + name + aliases) and classifies every session that identity
 * attended via the SAME `classifyOwed` — so this audit always matches the
 * card the player sees, and surfaces exactly which weeks are excluded and why
 * (paid, written off, unsettled with no recorded cost, settled-but-zero, etc.).
 *
 * The `names` array exposes the distinct linked names found, so an admin can
 * spot a week signed up under an UNLINKED variant (→ add an alias to merge it).
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface AuditRow {
  sessionId: string;
  date: string;
  rowName: string;
  settled: boolean;
  attended: boolean;
  paid: boolean;
  writtenOff: boolean;
  owedAmount: number;
  counted: boolean;
  reason: OwedReason;
}

export async function GET(req: NextRequest) {
  // Rate limit before auth so it can't be bypassed (CLAUDE.md security #4).
  const ip = getClientIp(req);
  if (!checkRateLimit(`owed-audit:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();

  const name = req.nextUrl.searchParams.get('name')?.trim() || undefined;
  const memberId = req.nextUrl.searchParams.get('memberId')?.trim() || undefined;
  if (!name && !memberId) {
    return NextResponse.json({ error: 'name or memberId required' }, { status: 400 });
  }

  try {
    const sessionsContainer = getContainer('sessions');
    const playersContainer = getContainer('players');
    const activeSessionId = await getActiveSessionId();
    const now = Date.now();

    const identity = await resolveIdentity({ name, memberId });

    const { resources: allSessions } = await sessionsContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id != @pointerId AND c.id != @legacyId',
        parameters: [
          { name: '@pointerId', value: POINTER_ID },
          { name: '@legacyId', value: 'current-session' },
        ],
      })
      .fetchAll();
    const sessionById = new Map<string, Session>();
    for (const s of allSessions as Session[]) sessionById.set(s.id, s);

    // All players (small dataset for a friend group); we need the full roster
    // per session for the live-share denominator, then filter to this identity.
    const { resources: allPlayers } = await playersContainer.items
      .query({ query: 'SELECT * FROM c' })
      .fetchAll();
    const players = allPlayers as Player[];

    const activeCountBySession = new Map<string, number>();
    for (const p of players) {
      if (!sessionById.has(p.sessionId)) continue;
      if (p.removed === true || p.waitlisted === true) continue;
      activeCountBySession.set(p.sessionId, (activeCountBySession.get(p.sessionId) ?? 0) + 1);
    }

    const linkedNames = new Set<string>();
    const rows: AuditRow[] = [];
    for (const p of players) {
      if (!matchesIdentity(p, identity)) continue;
      const session = sessionById.get(p.sessionId);
      if (!session) continue;
      if (typeof p.name === 'string') linkedNames.add(p.name);

      const result = classifyOwed(p, session, {
        activeSessionId,
        now,
        activeCount: activeCountBySession.get(p.sessionId) ?? 0,
      });

      rows.push({
        sessionId: p.sessionId,
        date: session.datetime ?? '',
        rowName: p.name ?? '',
        settled: !!session.settled,
        attended: p.removed !== true && p.waitlisted !== true,
        paid: p.paid === true,
        writtenOff: p.writtenOff === true,
        owedAmount: result.owedAmount,
        counted: result.counted,
        reason: result.reason,
      });
    }

    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    const totalOwed = round2(rows.reduce((sum, r) => sum + (r.counted ? r.owedAmount : 0), 0));
    const countedCount = rows.filter((r) => r.counted).length;

    return NextResponse.json({
      names: Array.from(linkedNames),
      totalOwed,
      countedCount,
      sessionCount: rows.length,
      sessions: rows,
    });
  } catch (error) {
    console.error('GET /api/admin/owed-audit error:', error);
    return NextResponse.json({ error: 'Failed to compute owed audit' }, { status: 500 });
  }
}
