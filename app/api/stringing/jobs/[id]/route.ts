/**
 * PATCH /api/stringing/jobs/[id] — move a job along the bench. Admin only.
 *
 * Every field here is stringer-owned. A player has no write path to their own
 * job at all in Stage 1, deliberately: the states this route sets are claims
 * about the physical world ("I have the racket", "it is strung", "you paid
 * me") and only the person holding the racket can make them. When the player
 * side lands, accepting a quote gets its own narrowly-scoped route rather than
 * an extra field here.
 *
 * Corrections are first-class. `canTransition` permits any status to any
 * status — see lib/stringing.ts for why — so what protects the record is the
 * append-only `history`, not a refusal.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthedWithMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isStringingStatus, isValidTension, canTransition } from '@/lib/stringing';
import type { StringingJob } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const WRITES_PER_HOUR = 120;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-patch:${ip}`, WRITES_PER_HOUR, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  // The partition key VALUE, not the doc id — the mock store ignores partition
  // keys, so getting this wrong only breaks in production.
  const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : '';
  if (!memberId) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const container = getContainer('stringingJobs');
    const { resource: job } = await container.item(id, memberId).read<StringingJob>();
    if (!job) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const next: StringingJob = { ...job, updatedAt: now };

    if (body.status !== undefined) {
      if (!isStringingStatus(body.status) || !canTransition(job.status, body.status)) {
        return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
      }
      // Only append when it actually moved. Re-tapping the current step is a
      // no-op, not an audit entry — otherwise the history fills with noise and
      // stops being readable as the record of what happened.
      if (body.status !== job.status) {
        next.status = body.status;
        next.history = [...job.history, { status: body.status, at: now, by: admin.memberId }];
      }
    }

    if (body.priceCents !== undefined) {
      const p = body.priceCents;
      const valid = p === null || (Number.isInteger(p) && p >= 0 && p <= 100000);
      if (!valid) return NextResponse.json({ error: 'invalid_price' }, { status: 400 });
      next.priceCents = p;
    }

    if (body.tensionMains !== undefined || body.tensionCrosses !== undefined) {
      const mains = body.tensionMains ?? job.tensionMains;
      const crosses = body.tensionCrosses ?? job.tensionCrosses;
      if (!isValidTension(mains) || !isValidTension(crosses)) {
        return NextResponse.json({ error: 'invalid_tension' }, { status: 400 });
      }
      next.tensionMains = mains;
      next.tensionCrosses = crosses;
    }

    if (body.paid !== undefined) {
      // Boolean in, timestamp out: "when" is worth keeping and "whether" is
      // recoverable from it, never the other way round.
      next.paidAt = body.paid === true ? (job.paidAt ?? now) : null;
    }

    if (body.claim === true) {
      next.stringerId = admin.memberId;
      next.stringerName = admin.name;
    }

    if (body.readyBy !== undefined) {
      // Same rule as POST: a date or nothing. Legacy rows holding free text are
      // read back unchanged — this only governs what may be WRITTEN, so
      // existing jobs are not invalidated by the tightening.
      const r = body.readyBy;
      if (r === null || r === '') {
        next.readyBy = null;
      } else if (typeof r === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.trim())) {
        next.readyBy = r.trim();
      } else {
        return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
      }
    }

    await container.item(id, memberId).replace(next);
    return NextResponse.json({ job: next });
  } catch (err) {
    console.error(`PATCH /api/stringing/jobs/${id} failed:`, err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
