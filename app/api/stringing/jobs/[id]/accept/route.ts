/**
 * POST /api/stringing/jobs/[id]/accept — the player answers a proposed change.
 *
 * THE NARROWLY-SCOPED ROUTE THE BENCH PATCH ASKED FOR. Its sibling's docblock
 * has said since Stage 1: "A player has no write path to their own job at all
 * ... When the player side lands, accepting a quote gets its own narrowly-scoped
 * route rather than an extra field here." This is that route, and the scope is
 * the point — the only thing a player may do to their own job is answer a
 * question the stringer asked. They cannot set a price, move a status, or
 * propose anything themselves.
 *
 * AUTHORISATION IS THE PARTITION KEY. Identity comes from the `member_session`
 * cookie and never from the body — the same rule `requests/route.ts` states —
 * and the document is read at `item(id, caller.memberId)`. Because `/memberId`
 * IS the partition key, another member's job id simply misses: there is no
 * ownership comparison to get backwards, because there is no branch. The JS
 * re-check below is belt to that brace, since the mock store ignores partition
 * keys entirely and would otherwise hand back a row from anybody's partition.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { verifyMemberAuth } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { toPlayerJob } from '../../route';
import type { StringingJob } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
/** Its own bucket. Answering is rare and deliberate; it must not share a budget
 *  with the bench's own writes. */
const ANSWERS_PER_HOUR = 30;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Rule 4 — rate limit before auth.
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-accept:${ip}`, ANSWERS_PER_HOUR, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const caller = verifyMemberAuth(req);
  if (!caller) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const decision = body && typeof body === 'object' ? body.decision : null;
  if (decision !== 'accept' && decision !== 'decline') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const container = getContainer('stringingJobs');
    // The caller's OWN partition. Not a filter — the address itself.
    const { resource: job } = await container
      .item(id, caller.memberId)
      .read<StringingJob>();
    if (!job || job.memberId !== caller.memberId || job.id !== id) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const pending = job.pendingEdit;
    if (!pending) {
      // Nothing to answer. A 409 rather than a silent success, because the
      // likely cause is a stale sheet — the stringer withdrew the change, or
      // it was already answered on another device — and the client needs to
      // reload rather than believe it did something.
      return NextResponse.json({ error: 'no_pending_edit' }, { status: 409 });
    }

    const now = new Date().toISOString();
    const next: StringingJob = { ...job, updatedAt: now, pendingEdit: null };

    if (decision === 'accept') {
      if (pending.racketLabel !== undefined) next.racketLabel = pending.racketLabel;
      if (pending.stringLabel !== undefined) next.stringLabel = pending.stringLabel;
      if (pending.tensionMains !== undefined) next.tensionMains = pending.tensionMains;
      if (pending.tensionCrosses !== undefined) next.tensionCrosses = pending.tensionCrosses;
      if (pending.priceCents !== undefined) next.priceCents = pending.priceCents;
      // The field that has existed since Stage 1 with nothing ever writing it.
      next.acceptedAt = now;
      next.pendingEditDeclinedAt = null;
    } else {
      // Declining changes NOTHING about the job — the old values stand. All it
      // records is that somebody was asked and said no, which is what stops the
      // bench reading "no answer yet" forever.
      next.pendingEditDeclinedAt = now;
    }

    await container.item(id, caller.memberId).replace(next);
    // Through `toPlayerJob`, like every other player-facing response: the
    // strip cannot be forgotten at a call site.
    return NextResponse.json({ job: toPlayerJob(next) });
  } catch (err) {
    console.error(`POST /api/stringing/jobs/${id}/accept failed:`, err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
