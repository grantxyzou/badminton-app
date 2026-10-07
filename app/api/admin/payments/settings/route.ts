/**
 * PATCH /api/admin/payments/settings — `{ holdAfterUnpaid?, remindersOn? }`:
 * the unpaid soft hold (2, usually, or 0 = off) and payment reminders. Both
 * are off by default, and the admin card shows who each would affect before
 * offering the switch (docs/plans/payments.md).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { notePaymentsSettings } from '@/lib/paymentsInbox';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!checkRateLimit(`admin-payments-settings:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const hold = body.holdAfterUnpaid;
  const reminders = body.remindersOn;
  if (hold === undefined && reminders === undefined) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (hold !== undefined && (typeof hold !== 'number' || !Number.isInteger(hold) || hold < 0 || hold > 10)) {
    return NextResponse.json({ error: 'invalid_hold' }, { status: 400 });
  }
  if (reminders !== undefined && typeof reminders !== 'boolean') {
    return NextResponse.json({ error: 'invalid_reminders' }, { status: 400 });
  }
  try {
    await notePaymentsSettings(resolveGroupId(req), {
      ...(hold !== undefined ? { holdAfterUnpaid: hold as number } : {}),
      ...(reminders !== undefined ? { remindersOn: reminders as boolean } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PATCH /api/admin/payments/settings failed', err);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
