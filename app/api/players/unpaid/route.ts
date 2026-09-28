import { NextRequest, NextResponse } from 'next/server';
import { getActiveSessionId } from '@/lib/cosmos';
import { groupScope, type GroupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { ownsNameOrAdmin } from '@/lib/auth';
import { resolveIdentity, classifyOwed } from '@/lib/playerIdentity';
import { loadOwedInputs } from '@/lib/owedRows';
import { isFlagOn } from '@/lib/flags';
import { stringingCharges, stringingTotal, type StringingCharge } from '@/lib/stringingBilling';
import type { StringingJob } from '@/lib/types';

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

/**
 * Stringing charges for this member, or [] when there are none to add.
 *
 * Deliberately swallows its own failure. The balance card's PRIMARY job is
 * session money, and a stringing container that does not exist yet — or a
 * throw while reading it — must not take the whole balance down with it. The
 * asymmetry is intentional: showing session debt without stringing is
 * incomplete, while showing nothing at all is useless.
 */
async function chargesFor(scope: GroupScope, memberId: string | null): Promise<StringingCharge[]> {
  if (!memberId || !isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return [];
  try {
    const resources = await scope.query<StringingJob>('stringingJobs', {
      where: 'c.memberId = @memberId',
      params: [{ name: '@memberId', value: memberId }],
    });
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
    const scope = groupScope(resolveGroupId(req));
    // Only an EXCLUSION comparand here (the active session is not yet a debt);
    // a group with no session excludes nothing, which is right.
    const activeSessionId = await getActiveSessionId(scope.groupId);
    const now = Date.now();

    const identity = await resolveIdentity({ name }, scope.groupId);

    // PLAYER-FIRST (lib/owedRows.ts): this person's rows, then only the
    // sessions they name, then the roster of only the unsettled ones. This
    // route runs on every Home mount and used to read the whole history of
    // two containers to answer for one person. `classifyOwed` decides which
    // sessions can carry a debt (settled, or past and not active).
    const { players, sessionById, activeCountBySession } = await loadOwedInputs(scope, identity);

    const unpaid: UnpaidSession[] = [];
    for (const p of players) {
      const session = sessionById.get(p.sessionId);
      if (!session) continue;
      const result = classifyOwed(p, session, {
        activeSessionId: activeSessionId ?? '',
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
    const stringing = await chargesFor(scope, identity.memberId);
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
