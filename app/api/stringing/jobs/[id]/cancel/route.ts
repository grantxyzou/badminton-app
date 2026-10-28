/**
 * POST /api/stringing/jobs/[id]/cancel — the player calls off a request they
 * have not handed the racket over for yet (docs/plans/stringing-canvas-redesign.md;
 * Grant, 2026-10-28: "add the cancel too").
 *
 * ONLY WHILE `requested`. Once the stringer has the racket, cancelling is a
 * conversation about getting it back, not a button: the route answers 409
 * `already_received` and the card no longer offers it. A requested job owes
 * nothing (`isBillable` needs a finished one), so cancelling moves no money.
 *
 * The job is ARCHIVED, not deleted, and stamped `cancelledAt`: the bench keeps
 * the record (who asked, for what, and that they called it off) and the
 * archive is where an admin looks for it. Deleting stays the admin's, from the
 * archive.
 *
 * Authorisation is the partition key, as in the sibling `accept` route: the
 * job is read at the caller's OWN `memberId`, from the `member_session`
 * cookie, never the body; the JS re-check covers the mock store, which
 * ignores partition keys.
 */
import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { verifyMemberAuth } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { toPlayerJob } from '../../route';
import type { StringingJob } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
/** Its own bucket, like answering a change: rare and deliberate. */
const CANCELS_PER_HOUR = 20;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Rule 4 — rate limit before auth.
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-cancel:${ip}`, CANCELS_PER_HOUR, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const caller = verifyMemberAuth(req);
  if (!caller) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  try {
    const scope = groupScope(resolveGroupId(req));
    const job = await scope.read<StringingJob>('stringingJobs', id, caller.memberId);
    if (!job || job.memberId !== caller.memberId || job.id !== id || job.archivedAt) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (job.status !== 'requested') {
      // The racket is with the stringer: a stale card, or another device.
      return NextResponse.json({ error: 'already_received' }, { status: 409 });
    }

    const now = new Date().toISOString();
    const next: StringingJob = { ...job, archivedAt: now, cancelledAt: now, pendingEdit: null, updatedAt: now };
    // `replace`, etag-conditional: a status move landing meanwhile (the
    // stringer marking it received) wins, and this answers 409.
    const written = await scope.replace('stringingJobs', next, caller.memberId);
    if (!written) {
      const still = await scope.read<StringingJob>('stringingJobs', id, caller.memberId);
      return still
        ? NextResponse.json({ error: 'changed_elsewhere' }, { status: 409 })
        : NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ job: toPlayerJob(next) });
  } catch (err) {
    console.error(`POST /api/stringing/jobs/${id}/cancel failed:`, err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
