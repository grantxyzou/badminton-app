/**
 * POST /api/cron/tick — the hourly tick (docs/plans/stringing-request-nudge.md).
 *
 * Called by `.github/workflows/tick.yml` with `x-cron-key`. Runs every timed
 * job in `lib/tick.ts` for every open club and answers with counts only: no
 * name, no id, nothing about a member, so the workflow's log can be read by
 * anyone with access to the repository.
 *
 * Order: rate limit (rule 4), then the key. `CRON_KEY` unset answers 503,
 * never an open door. No cookie: GitHub has none, and the key is the only
 * credential this route takes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { CRON_KEY_HEADER, cronKeyConfigured, cronKeyMatches, runTick } from '@/lib/tick';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
/** The schedule calls once an hour; a hand-run or a retry fits well inside this. */
const CALLS_PER_HOUR = 12;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`cron-tick:${ip}`, CALLS_PER_HOUR, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!cronKeyConfigured()) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  if (!cronKeyMatches(req.headers.get(CRON_KEY_HEADER))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const run = await runTick(Date.now());
    return NextResponse.json({ ok: true, ...run });
  } catch (err) {
    console.error('[tick] run failed:', err);
    return NextResponse.json({ error: 'tick_failed' }, { status: 503 });
  }
}
