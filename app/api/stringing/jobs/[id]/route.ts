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
import { notifyPlayerOfStage, notifyPlayerOfPendingEdit } from '@/lib/stringingNotifyDispatch';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthedWithMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isStringingStatus, isValidTension, canTransition } from '@/lib/stringing';
import type { StringingJob, PendingEdit } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const WRITES_PER_HOUR = 120;
/* Its own, much smaller bucket. Deleting is not something anyone does in bulk,
   and a budget shared with PATCH would let ordinary bench work exhaust it. */
const DELETES_PER_HOUR = 20;

/**
 * Validate a proposed change into a `PendingEdit`, keeping only fields that
 * actually DIFFER from the job as it stands.
 *
 * Dropping no-op fields is what keeps the player's prompt honest: a diff
 * listing "BG65 → BG65" alongside a real price change reads as three changes
 * and teaches people to skim. If nothing differs there is nothing to ask.
 */
function parseProposal(
  raw: unknown,
  job: StringingJob,
  now: string,
  by: string | null,
): { value: PendingEdit } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'invalid_request' };
  const b = raw as Record<string, unknown>;
  const out: PendingEdit = { proposedAt: now, proposedBy: by };

  for (const key of ['racketLabel', 'stringLabel'] as const) {
    if (b[key] === undefined) continue;
    const v = typeof b[key] === 'string' ? (b[key] as string).trim() : '';
    if (!v || v.length > 80) return { error: 'invalid_request' };
    if (v !== job[key]) out[key] = v;
  }

  if (b.tensionMains !== undefined || b.tensionCrosses !== undefined) {
    const mains = (b.tensionMains ?? job.tensionMains) as number;
    const crosses = (b.tensionCrosses ?? job.tensionCrosses) as number;
    if (!isValidTension(mains) || !isValidTension(crosses)) {
      return { error: 'invalid_tension' };
    }
    if (mains !== job.tensionMains) out.tensionMains = mains;
    if (crosses !== job.tensionCrosses) out.tensionCrosses = crosses;
  }

  if (b.priceCents !== undefined) {
    const p = b.priceCents;
    const ok = p === null || (Number.isInteger(p) && (p as number) >= 0 && (p as number) <= 100000);
    if (!ok) return { error: 'invalid_price' };
    if (p !== job.priceCents) out.priceCents = p as number | null;
  }

  const changed = Object.keys(out).some((k) => k !== 'proposedAt' && k !== 'proposedBy');
  if (!changed) return { error: 'no_change' };
  return { value: out };
}

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
      /**
       * Changing a price the player has ALREADY been told needs their answer,
       * so it goes through `propose` instead — 409 here, with `force` as the
       * escape hatch for a genuine typo. Setting the FIRST price is a direct
       * write: there is nobody to confirm with yet.
       *
       * Gated on an actual CHANGE, not on the key being present. This route has
       * already been bitten by over-eager validation — the "does not invalidate
       * a legacy row on an unrelated PATCH" test exists because of it — and
       * `StringingJobDetail` spreads its whole body, so a status tap must not
       * trip a price guard.
       *
       * Same guard-then-escape shape as settle's "unsettle first": money that
       * somebody has been quoted does not change quietly.
       *
       * `force` IS reachable now: the detail screen's ellipsis beside "Send to
       * {name}" opens a two-tap "Change without asking". It is the exception
       * and is shaped like one — a ghost button, a confirm that names the new
       * price, and copy saying the player is neither asked nor told. Asking
       * keeps the filled button.
       */
      if (job.priceCents !== null && p !== job.priceCents && body.force !== true) {
        return NextResponse.json({ error: 'confirm_required' }, { status: 409 });
      }
      next.priceCents = p;
      /**
       * A forced write INVALIDATES any outstanding proposal.
       *
       * Otherwise the two price mechanisms drift apart and the older one wins:
       * propose $34, then force $35, and the player is shown "$35 → $34" — a
       * diff that reads as coherent while describing a price the admin has
       * already moved past. Accepting it would then silently revert the $35
       * with no signal to anybody.
       *
       * Not reachable from the UI today (nothing sends `force`), but the route
       * accepts it, and a feature whose entire point is that a price cannot
       * change without agreement should not leave a live proposal pointing at
       * a number that no longer exists.
       */
      if (p !== job.priceCents) {
        next.pendingEdit = null;
      }
    }

    if (body.propose !== undefined) {
      const proposal = parseProposal(body.propose, job, now, admin.memberId);
      if ('error' in proposal) {
        return NextResponse.json({ error: proposal.error }, { status: 400 });
      }
      next.pendingEdit = proposal.value;
      // A fresh ask clears the last refusal: the bench should say "waiting on
      // Lin", not go on reporting a no she has already been asked past.
      next.pendingEditDeclinedAt = null;
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

      /**
       * ARCHIVING WITHDRAWS AN UNANSWERED PROPOSAL.
       *
       * Without this the two features combine into a dead state: a player
       * never sees an archived job, so archiving one with a question
       * outstanding removes the only way to answer it — while the bench goes
       * on displaying "Waiting on Lin to confirm", which is then simply false.
       * Nobody would guess that un-archiving is the way out.
       *
       * Withdrawing is the honest reading of the gesture. Archiving a job says
       * "I am done with this"; you cannot be done with it and still be waiting
       * on somebody. Re-proposing after un-archiving costs one tap, and no
       * price moves in the meantime — a withdrawn proposal was never applied.
       */
      if (body.archived === true) {
        next.pendingEdit = null;
      }
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

    /* Same posture as the stage notice: awaited, best-effort, never able to
       fail the admin's action. Fired only when a proposal is genuinely NEW —
       re-saving a job with an unchanged pending edit must not re-ask. */
    if (next.pendingEdit && next.pendingEdit.proposedAt !== job.pendingEdit?.proposedAt) {
      await notifyPlayerOfPendingEdit(next);
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
