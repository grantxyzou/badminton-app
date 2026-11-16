/**
 * POST /api/admin/payments/assign — the admin's one tap on a queued e-transfer.
 *
 *   { paymentId, action: 'assign', memberId? | name?, refs?, remember? }
 *   { paymentId, action: 'ignore', name?, remember? }  — dismiss, optionally learning the sender
 *
 * `refs` are the owed lines (player row ids / stringing job ids) the money
 * pays; omitted, the clean allocation is used if there is one. `remember`
 * saves the transfer's sender name as an alias of the person, which is what
 * makes the next one from them match on its own.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { AssignError, resolvePayment } from '@/lib/paymentsInbox';
import { CreditReviewError, returnCredit } from '@/lib/creditReview';
import { groupScope } from '@/lib/groupScope';

export const dynamic = 'force-dynamic';

const STATUS: Record<AssignError['code'] | CreditReviewError['code'], number> = {
  not_found: 404,
  already_resolved: 409,
  not_owed: 409,
  unknown_person: 400,
  not_a_payment: 409,
  row_changed: 409,
};

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!checkRateLimit(`admin-payments-assign:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const paymentId = typeof body.paymentId === 'string' ? body.paymentId : '';
  if (!paymentId || (body.action !== 'assign' && body.action !== 'ignore' && body.action !== 'return_credit')) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const refs = Array.isArray(body.refs) ? body.refs.filter((r): r is string => typeof r === 'string').slice(0, 50) : undefined;

  try {
    if (body.action === 'return_credit') {
      // The organiser's answer to a credit review row (docs/plans/money-audit.md, gap 6).
      return NextResponse.json(await returnCredit(groupScope(resolveGroupId(req)), paymentId, admin.memberId));
    }
    const payment = await resolvePayment(
      resolveGroupId(req),
      paymentId,
      body.action === 'ignore'
        ? {
            kind: 'ignore',
            adminId: admin.memberId,
            memberId: typeof body.memberId === 'string' ? body.memberId : undefined,
            name: typeof body.name === 'string' ? body.name.trim().slice(0, 50) : undefined,
            remember: body.remember === true,
          }
        : {
            kind: 'assign',
            adminId: admin.memberId,
            memberId: typeof body.memberId === 'string' ? body.memberId : undefined,
            name: typeof body.name === 'string' ? body.name.trim().slice(0, 50) : undefined,
            refs,
            remember: body.remember === true,
          },
    );
    return NextResponse.json(payment);
  } catch (err) {
    if (err instanceof AssignError || err instanceof CreditReviewError) return NextResponse.json({ error: err.code }, { status: STATUS[err.code] });
    console.error('POST /api/admin/payments/assign failed', err);
    return NextResponse.json({ error: 'assign_failed' }, { status: 500 });
  }
}
