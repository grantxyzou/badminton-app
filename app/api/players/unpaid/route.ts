import { NextRequest, NextResponse } from 'next/server';
import { getContainer, POINTER_ID, getActiveSessionId } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { ownsNameOrAdmin } from '@/lib/auth';
import { resolveIdentity, matchesIdentity, classifyOwed, finiteSessionDate } from '@/lib/playerIdentity';
import { isFlagOn } from '@/lib/flags';
import { stringingCharges, stringingTotal, type StringingCharge } from '@/lib/stringingBilling';
import type { Player, Session, StringingJob } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/players/unpaid?name=<name>
 *
 * A player's own "what do I still owe" view, used by the Profile
 * outstanding-payments card and the Home balance card.
 *
 * OWNER-OR-ADMIN. This used to be public-by-name, justified in this comment as
 * "same posture as /api/stats/attendance" — but that posture was removed on
 * 2026-08-25 when attendance, insight and partners were all gated, so the
 * precedent it leaned on no longer exists. It is also the most sensitive of the
 * set: attendance is who turned up, this is what a named person OWES. Member
 * names are enumerable via GET /api/members, so a name is not a credential.
 *
 * Identity is resolved via `resolveIdentity` (memberId + name + aliases), NOT a
 * raw name match — so weeks signed up under a renamed member or an alias-linked
 * name are no longer dropped. The per-session owed decision is delegated to the
 * shared `classifyOwed`, so this card and the admin owed-audit always agree.
 *
 * There is NO lookback window: every archived session is considered. A session
 * owes when it's SETTLED with a frozen `owedAmount > 0`, or UNSETTLED+past with a
 * recorded cost (live per-person share). The active session never counts via the
 * live path (its bill isn't due yet); a settled debt on it does.
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
  stringing: [] as StringingCharge[],
  sessionsOwed: 0,
  stringingOwed: 0,
};

/**
 * Stringing charges for this member, or [] when there are none to add.
 *
 * Deliberately swallows its own failure. The balance card's PRIMARY job is
 * session money, and a stringing container that does not exist yet — or a
 * throw while reading it — must not take the whole balance down with it. The
 * asymmetry is intentional: showing session debt without stringing is
 * incomplete, while showing nothing at all is useless.
 */
async function chargesFor(memberId: string | null): Promise<StringingCharge[]> {
  if (!memberId || !isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return [];
  try {
    const { resources } = await getContainer('stringingJobs')
      .items.query<StringingJob>({
        query: 'SELECT * FROM c WHERE c.memberId = @memberId',
        parameters: [{ name: '@memberId', value: memberId }],
      })
      .fetchAll();
    return stringingCharges(resources);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  // Rate limit before anything else (CLAUDE.md security #4).
  const ip = getClientIp(req);
  if (!checkRateLimit(`unpaid:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const name = req.nextUrl.searchParams.get('name')?.trim();
  // A missing name is a bad request, not a person who owes nothing. Returning
  // EMPTY at HTTP 200 made the two indistinguishable to the caller — the same
  // lying-empty-state that /api/stats/partners was fixed for.
  if (!name) {
    return NextResponse.json({ error: 'name_required' }, { status: 400 });
  }

  // Auth before DB (rule 3).
  if (!ownsNameOrAdmin(req, name)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const sessionsContainer = getContainer('sessions');
    const playersContainer = getContainer('players');
    const activeSessionId = await getActiveSessionId();
    const now = Date.now();

    const identity = await resolveIdentity({ name });

    const { resources: allSessions } = await sessionsContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id != @pointerId AND c.id != @legacyId',
        parameters: [
          { name: '@pointerId', value: POINTER_ID },
          { name: '@legacyId', value: 'current-session' },
        ],
      })
      .fetchAll();

    // Sessions a debt can come from: settled (frozen amount) OR unsettled & past
    // & not the active session (live share). Both require a finite datetime.
    const relevant = (allSessions as Session[]).filter((s) => {
      if (!finiteSessionDate(s)) return false;
      if (s.settled) return true;
      return s.id !== activeSessionId && new Date(s.datetime).getTime() < now;
    });
    if (relevant.length === 0) {
      // Not EMPTY: a player can have no session debt and still owe for a
      // racket. Returning the constant here would hide the charge entirely.
      const stringing = await chargesFor(identity.memberId);
      const stringingOwed = stringingTotal(stringing);
      return NextResponse.json({
        ...EMPTY,
        stringing,
        stringingOwed,
        totalOwed: stringingOwed,
      });
    }

    const sessionById = new Map<string, Session>();
    for (const s of relevant) sessionById.set(s.id, s);
    const sessionIds = relevant.map((s) => s.id);
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
    const players = (rawPlayers as Player[]).filter((p) => sessionIdSet.has(p.sessionId));

    // Full active-roster size per session = the live per-person denominator.
    // Counted independent of who's asking, so the share is right regardless of
    // how many have paid.
    const activeCountBySession = new Map<string, number>();
    for (const p of players) {
      if (p.removed === true || p.waitlisted === true) continue;
      activeCountBySession.set(p.sessionId, (activeCountBySession.get(p.sessionId) ?? 0) + 1);
    }

    const unpaid: UnpaidSession[] = [];
    for (const p of players) {
      if (!matchesIdentity(p, identity)) continue;
      const session = sessionById.get(p.sessionId);
      if (!session) continue;
      const result = classifyOwed(p, session, {
        activeSessionId,
        now,
        activeCount: activeCountBySession.get(p.sessionId) ?? 0,
      });
      if (result.counted) {
        unpaid.push({ sessionId: p.sessionId, date: session.datetime, owedAmount: result.owedAmount });
      }
    }

    // Newest first.
    unpaid.sort((a, b) => (a.date < b.date ? 1 : -1));
    const sessionsOwed = round2(unpaid.reduce((sum, s) => sum + s.owedAmount, 0));
    const stringing = await chargesFor(identity.memberId);
    const stringingOwed = stringingTotal(stringing);

    return NextResponse.json({
      // `totalOwed` still means EVERYTHING owed, so existing callers that only
      // read it keep working and keep being right. The two halves are also
      // reported separately so the receipt can show its own subtotals without
      // re-deriving them and risking a total that disagrees with its lines.
      totalOwed: round2(sessionsOwed + stringingOwed),
      sessionsOwed,
      stringingOwed,
      sessionCount: unpaid.length,
      mostRecent: unpaid[0] ?? null,
      sessions: unpaid,
      stringing,
    });
  } catch (error) {
    console.error('GET /api/players/unpaid error:', error);
    return NextResponse.json({ error: 'Failed to load unpaid sessions' }, { status: 500 });
  }
}
