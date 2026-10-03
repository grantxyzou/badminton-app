import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { ownsNameOrAdmin } from '@/lib/auth';
import { resolveIdentity } from '@/lib/playerIdentity';
import { computeOwed } from '@/lib/owedBalance';
import { stringingTotal } from '@/lib/stringingBilling';
import { clubPayTo } from '@/lib/payTo';

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
    const identity = await resolveIdentity({ name }, scope.groupId);

    // One owner for "what does this person owe" (lib/owedBalance.ts), shared
    // with the e-transfer matcher so a payment of exactly this total matches.
    const { sessions: unpaid, stringing } = await computeOwed(scope, identity);
    const sessionsOwed = round2(unpaid.reduce((sum, s) => sum + s.owedAmount, 0));
    const stringingOwed = stringingTotal(stringing);
    const totalOwed = round2(sessionsOwed + stringingOwed);
    // Only to someone who owes — see lib/payTo.ts for why this is the one place.
    const payTo = totalOwed > 0 ? await clubPayTo(scope.groupId) : null;

    return NextResponse.json({
      // `totalOwed` still means EVERYTHING owed, so existing callers that only
      // read it keep working and keep being right. The two halves are also
      // reported separately so the receipt can show its own subtotals without
      // re-deriving them and risking a total that disagrees with its lines.
      totalOwed,
      sessionsOwed,
      stringingOwed,
      sessionCount: unpaid.length,
      mostRecent: unpaid[0] ?? null,
      sessions: unpaid,
      stringing,
      payTo,
    });
  } catch (error) {
    console.error('GET /api/players/unpaid error:', error);
    return NextResponse.json({ error: 'Failed to load unpaid sessions' }, { status: 500 });
  }
}
