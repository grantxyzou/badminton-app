/**
 * POST /api/stringing/jobs/[id]/invoice — send (or send again) a restring's
 * invoice (docs/plans/stringing-invoice.md).
 *
 * Body: `{ memberId }`, the job's partition key, as every job write takes.
 *
 * WHO: an organiser or admin of this club, or the stringer the job is
 * assigned to (Grant: "Stringer, organiser"), re-checked here like the status
 * write: `canStringIn` THIS club and `job.stringerId`.
 *
 * WHAT: a finished (Ready or Picked up), priced, unpaid, not withdrawn job.
 * The invoice is written on the job under its etag FIRST: for a job made with
 * `billOn: 'invoice'` that write is what makes it owed, so the ledger mirror
 * runs on it, and only then does anyone hear about it (`deliverInvoice`,
 * which never throws). A second tap inside a minute answers 409 `sending`,
 * so a double tap is one invoice. The answer says whether anything reached
 * the person; when nothing did, the bench offers the picture to share.
 *
 * Open while `NEXT_PUBLIC_FLAG_STRINGING_INVOICE` is on, and always for a job
 * that was made invoice-billed, so turning the flag off strands nobody.
 */
import { NextRequest, NextResponse } from 'next/server';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId } from '@/lib/groupContext';
import { isAdminAuthedWithMember, verifyLiveMemberAuth } from '@/lib/auth';
import { canStringIn } from '@/lib/roster';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { mirrorStringingChanged } from '@/lib/ledgerMirror';
import { deliverInvoice } from '@/lib/stringingInvoice';
import { invoiceJustSent, invoiceRefusal, invoiceView, withInvoiceSent } from '@/lib/stringingInvoiceView';
import { toStringerJob } from '../../route';
import type { StringingJob } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const SENDS_PER_HOUR = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Rule 4: rate limit before auth.
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-invoice:${ip}`, SENDS_PER_HOUR, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  const stringer = admin.authed ? null : await verifyLiveMemberAuth(req);
  if (!admin.authed && !stringer) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const actorId = admin.authed ? admin.memberId ?? null : stringer!.memberId;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (Object.keys(body).some((k) => k !== 'memberId')) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : '';
  if (!memberId) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  try {
    const groupId = resolveGroupId(req);
    const scope = groupScope(groupId);
    const job = await scope.read<StringingJob>('stringingJobs', id, memberId);
    if (!job || job.id !== id || job.memberId !== memberId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING_INVOICE') && job.billOn !== 'invoice') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    if (stringer) {
      // This club's stringer, and THIS job's: a stringer is not an organiser
      // over the bench, and the invoice is the one place they see a price.
      const can = await canStringIn(groupId, stringer.memberId).catch(() => false);
      if (!can || job.stringerId !== stringer.memberId) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
    }

    const refusal = invoiceRefusal(job);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });
    if (invoiceJustSent(job)) {
      return NextResponse.json({ error: 'sending', invoice: invoiceView(job) }, { status: 409 });
    }

    const now = new Date().toISOString();
    const next: StringingJob = { ...withInvoiceSent(job, now, actorId), updatedAt: now };
    const written = await scope.replace<StringingJob>('stringingJobs', next, memberId);
    if (!written) {
      const still = await scope.read<StringingJob>('stringingJobs', id, memberId);
      return still
        ? NextResponse.json({ error: 'changed_elsewhere' }, { status: 409 })
        : NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    // An invoice-billed job is charged now. A job that billed at Ready was
    // charged then, and the mirror sees no transition here.
    await mirrorStringingChanged(scope, job, written);

    const delivered = await deliverInvoice(written);
    return NextResponse.json({
      invoice: invoiceView(written),
      delivered,
      job: admin.authed ? written : { ...toStringerJob(written, { contact: true }), invoice: invoiceView(written) },
    });
  } catch (err) {
    console.error(`POST /api/stringing/jobs/${id}/invoice failed:`, err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
