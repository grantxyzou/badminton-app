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
import { notifyPlayerOfStage } from '@/lib/stringingNotifyDispatch';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthedWithMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isStringingStatus, isValidTension, canTransition } from '@/lib/stringing';
import type { StringingJob } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const WRITES_PER_HOUR = 120;
/* Its own, much smaller bucket. Deleting is not something anyone does in bulk,
   and a budget shared with PATCH would let ordinary bench work exhaust it. */
const DELETES_PER_HOUR = 20;

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

    if (body.archived !== undefined) {
      // Boolean in, timestamp out — same shape as `paid` above, and the
      // re-archive of an already-archived job keeps the original stamp so
      // "when did this leave the bench" survives a stray double-tap.
      next.archivedAt = body.archived === true ? (job.archivedAt ?? now) : null;
    }

    if (body.prioritized !== undefined) {
      next.prioritizedAt = body.prioritized === true ? (job.prioritizedAt ?? now) : null;
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

    /* THE NOTIFICATION SEAM'S ONLY CALLER.
       `lib/stringingNotify.ts` and its adapter shipped with nothing on either
       side of them, which meant no player was ever told their racket was ready
       — the biggest half-finished piece in the app. This is that wiring.

       Fired only when the status ACTUALLY moved (the same test the history
       append uses), so re-tapping the current step does not re-send.

       Archiving and pinning deliberately fall outside this: neither touches
       `status`, so neither appends to `history` nor sends anything. They are
       facts about the STRINGER'S list, not about the racket — nobody needs to
       be told their job moved up a queue they cannot see.

       AWAITED but never allowed to fail the request: the admin's action is
       about the racket, not the email. `notifyPlayerOfStage` swallows and logs
       everything, so a dead mail server cannot 503 the bench. */
    if (next.status !== job.status) {
      await notifyPlayerOfStage(next);
    }

    return NextResponse.json({ job: next });
  } catch (err) {
    console.error(`PATCH /api/stringing/jobs/${id} failed:`, err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}

/**
 * DELETE /api/stringing/jobs/[id] — destroy the record. Admin only.
 *
 * The FIRST destructive path in the stringing service, and the only one. Every
 * other write here is a correction; this is not recoverable.
 *
 * REACHABLE ONLY FROM THE ARCHIVE. A job that is not archived is refused with
 * 409 `not_archived`, which makes archiving the undo step: to delete something
 * you must first have taken it off the bench and looked at it there. That is
 * cheaper than a confirmation dialog and harder to do by accident.
 *
 * It does NOT refuse over money. Deleting a job with an outstanding balance
 * removes that line from the player's balance card, which is a real
 * consequence — but it is the admin's to make, so the UI names the figure that
 * will disappear and this route carries the seatbelt rather than the veto.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-delete:${ip}`, DELETES_PER_HOUR, HOUR_MS)) {
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
  // An explicit flag, so a stray DELETE cannot destroy a record by accident.
  // The real confirmation is the two-step in the sheet; this is the seatbelt
  // behind it. Same shape as `DELETE /api/members/me`.
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'confirmation_required' }, { status: 400 });
  }
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

    /**
     * RE-CHECK THE PREDICATE IN JS BEFORE DESTROYING ANYTHING.
     *
     * Both conditions are re-read off the document that actually came back,
     * rather than trusted from the request. The mock store ignores partition
     * keys and filters queries by parameter NAME rather than by SQL, so a
     * predicate that looks right can match far more than it should and still
     * pass every test — that is the `purgeMember` burn, which was type-clean
     * and deleted a row it had no business touching. On a delete, cheap
     * paranoia is the correct amount of paranoia.
     */
    if (job.id !== id || job.memberId !== memberId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (typeof job.archivedAt !== 'string' || job.archivedAt.length === 0) {
      return NextResponse.json({ error: 'not_archived' }, { status: 409 });
    }

    await container.item(id, memberId).delete();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`DELETE /api/stringing/jobs/${id} failed:`, err);
    return NextResponse.json({ error: 'delete_failed' }, { status: 503 });
  }
}
