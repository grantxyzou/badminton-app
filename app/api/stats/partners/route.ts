import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ownsNameOrAdmin } from '@/lib/auth';
import { topPartners } from '@/lib/recommend';

export const dynamic = 'force-dynamic';

// session id format is `session-YYYY-MM-DD`; derive a cutoff date from `weeks`.
function cutoffSessionId(weeks: number): string {
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7);
  return `session-${d.toISOString().slice(0, 10)}`;
}

export async function GET(req: NextRequest) {
  // Rate limit FIRST (rule 4) — it must not be bypassable by anything above it.
  // Probes by name — rate-limited like /api/members/me. The trip returns a real
  // 429: it used to answer `{ partners: [] }` with HTTP 200, which the client
  // (WhoYouPlayWithCard) took as a successful empty result and rendered as
  // "you haven't played with anyone yet" — a throttle that lies about the data.
  const ip = getClientIp(req);
  if (!checkRateLimit(`partners:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const name = url.searchParams.get('name')?.trim().slice(0, 50) ?? '';
  // A missing name is a bad request, not an empty social graph — same reason
  // as the 429 above.
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  // Privacy gate: this is a member's social graph (who they play with). Own
  // the name via `member_session`, or be an admin. Same posture as /stats/level.
  if (!ownsNameOrAdmin(req, name)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    // Default to 12 when absent. Note: `Number(null)` is 0 (finite), so reading
    // the raw param directly would make an omitted `weeks` resolve to a 1-week
    // window, not 12 — default the string before coercing.
    const weeksParam = Number(url.searchParams.get('weeks') ?? '12');
    const weeks = Number.isFinite(weeksParam) && weeksParam > 0 ? Math.min(Math.floor(weeksParam), 260) : 12;

    const cutoff = cutoffSessionId(weeks);
    const players = getContainer('players');
    // The `>=` cutoff is valid Cosmos SQL (prod-efficient). The mock store ignores
    // it and returns everything, so we ALSO apply the cutoff + removed filter
    // JS-side — that way mock and prod behave identically (CLAUDE.md rule).
    const { resources } = await players.items
      .query({
        query: 'SELECT c.sessionId, c.name, c.removed FROM c WHERE c.sessionId >= @cutoff',
        parameters: [{ name: '@cutoff', value: cutoff }],
      })
      .fetchAll();

    const bySession = new Map<string, string[]>();
    for (const row of resources) {
      if (typeof row.sessionId !== 'string' || typeof row.name !== 'string') continue;
      if (row.removed === true) continue;
      if (row.sessionId < cutoff) continue;
      const arr = bySession.get(row.sessionId) ?? [];
      arr.push(row.name);
      bySession.set(row.sessionId, arr);
    }
    const sessions = [...bySession.entries()].map(([sessionId, names]) => ({ sessionId, names }));

    return NextResponse.json({ partners: topPartners({ me: name, sessions, limit: 5 }) });
  } catch (error) {
    console.error('GET stats/partners error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
