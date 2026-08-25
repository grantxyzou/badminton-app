import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer, getActiveSessionId } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { verifyMemberAuth } from '@/lib/auth';
import { drillDocId, readDone, type DrillCompletionDoc } from '@/lib/drillsDone';
import { resolveActiveSubject } from '@/lib/memberResolve';

/**
 * Mark a drill done (or not) for the current week.
 *
 * The first non-GET route under app/api/stats. Two things about it are
 * deliberate:
 *
 * 1. THE WRITER IS THE COOKIE, NEVER A NAME IN THE BODY (rule 12). Member
 *    names are enumerable via GET /api/members, so a name-keyed write would
 *    let anyone tick off a stranger's drills. There is no admin-on-behalf
 *    branch either — the same posture as the append-only `events` container.
 *    An admin marking someone else's practice done is not a meaningful action.
 *
 * 2. `weekKey` IS SERVER-DERIVED. It is the active session id, which is
 *    exactly the seed `lib/drills.ts` rotates picks by — so "this week's
 *    drills" and "this week's completions" cannot drift apart. Accepting it
 *    from the client would also let a caller write into an arbitrary week.
 *
 * Idempotent by construction: the write is a set membership toggle, so a
 * double-tap on a flaky connection cannot double-count.
 */

export const dynamic = 'force-dynamic';

let ready: Promise<void> | null = null;
function ensureDrillsDone(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('drillCompletions', '/memberId').catch((err) => {
      // Null it so a transient failure doesn't permanently poison the module.
      ready = null;
      throw err;
    });
  }
  return ready;
}


export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`drills-done:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  if (!isFlagOn('NEXT_PUBLIC_FLAG_STATS_V2')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const caller = verifyMemberAuth(req);
  if (!caller?.name) {
    return NextResponse.json({ error: 'auth_required' }, { status: 401 });
  }

  let body: { drillId?: unknown; done?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const drillId = typeof body.drillId === 'string' ? body.drillId.trim().slice(0, 80) : '';
  if (!drillId || typeof body.done !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    await ensureDrillsDone();
    const [memberId, weekKey] = await Promise.all([
      (await resolveActiveSubject(caller.name)).memberId,
      getActiveSessionId(),
    ]);

    const container = getContainer('drillCompletions');
    const id = drillDocId(memberId, weekKey);
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id AND c.memberId = @memberId',
        parameters: [
          { name: '@id', value: id },
          { name: '@memberId', value: memberId },
        ],
      })
      .fetchAll();

    const existing = (resources[0] as DrillCompletionDoc | undefined) ?? null;
    const current = new Set(readDone(existing));
    if (body.done) current.add(drillId);
    else current.delete(drillId);
    const done = [...current];

    const doc: DrillCompletionDoc = {
      id,
      memberId,
      weekKey,
      done,
      updatedAt: new Date().toISOString(),
    };
    await container.items.upsert(doc);

    return NextResponse.json({ done, weekKey });
  } catch (error) {
    console.error('POST stats/drills/done error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
