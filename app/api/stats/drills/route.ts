import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer, getActiveSessionId } from '@/lib/cosmos';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ownsNameOrAdmin } from '@/lib/auth';
import { drillPicksFor } from '@/lib/drills';
import { drillDocId, readDone, type DrillCompletionDoc } from '@/lib/drillsDone';
import { resolveActiveSubject } from '@/lib/memberResolve';

/**
 * Practice drills for a member's weakest skills — private by design, same gate
 * as /api/stats/level: served only to the member (matching `member_session`
 * cookie) or an admin, since the drills are derived from private work-on skills.
 *
 * Order follows the security rules: rate limit (rule 4) → flag (404 off) →
 * privacy gate (rule 12 posture) → resolve subject → derive.
 */

export const dynamic = 'force-dynamic';

/** Name → subject id. Mirrors `resolveActiveSubject` in app/api/stats/level/route.ts. */

/**
 * This week's completions for a member. Best-effort: the drills themselves are
 * the payload, and a completions read that fails must degrade to an empty
 * counter rather than 500 the whole card.
 */
async function fetchDone(memberId: string, weekKey: string): Promise<string[]> {
  try {
    await ensureContainer('drillCompletions', '/memberId');
    const id = drillDocId(memberId, weekKey);
    const { resources } = await getContainer('drillCompletions').items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id AND c.memberId = @memberId',
        parameters: [
          { name: '@id', value: id },
          { name: '@memberId', value: memberId },
        ],
      })
      .fetchAll();
    return readDone(resources[0] as DrillCompletionDoc | undefined);
  } catch (err) {
    console.error('stats/drills: completions read failed:', err);
    return [];
  }
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`stats-drills:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  // Privacy gate: own this name (member cookie) or admin. Same posture as /level.
  if (!ownsNameOrAdmin(req, name)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const subject = await resolveActiveSubject(name);
    const [drills, rotationSeed] = await Promise.all([
      drillPicksFor(subject),
      getActiveSessionId(),
    ]);
    // `done` ships with the picks so the "n of 2" counter is right on the
    // FIRST paint. A second round-trip would render 0 of 2 for a beat and then
    // correct itself, which reads as the app forgetting what you did.
    const done = await fetchDone(subject.memberId, rotationSeed);
    return NextResponse.json({ drills, done });
  } catch (error) {
    console.error('GET stats/drills error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
