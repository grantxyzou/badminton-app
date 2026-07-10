import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { topPartners } from '@/lib/recommend';

export const dynamic = 'force-dynamic';

// session id format is `session-YYYY-MM-DD`; derive a cutoff date from `weeks`.
function cutoffSessionId(weeks: number): string {
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7);
  return `session-${d.toISOString().slice(0, 10)}`;
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Probes by name — rate-limit like /api/members/me.
  const ip = getClientIp(req);
  if (!checkRateLimit(`partners:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ partners: [] });
  }
  try {
    const url = new URL(req.url);
    const name = url.searchParams.get('name')?.trim().slice(0, 50) ?? '';
    // Default to 12 when absent. Note: `Number(null)` is 0 (finite), so reading
    // the raw param directly would make an omitted `weeks` resolve to a 1-week
    // window, not 12 — default the string before coercing.
    const weeksParam = Number(url.searchParams.get('weeks') ?? '12');
    const weeks = Number.isFinite(weeksParam) && weeksParam > 0 ? Math.min(Math.floor(weeksParam), 260) : 12;
    if (!name) return NextResponse.json({ partners: [] });

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
