/**
 * POST /api/payments/remind — the club's Gmail script asks, once a day, for
 * payment reminders to go out (docs/plans/payments.md, Phase 1b; the rules
 * are in lib/paymentReminders.ts).
 *
 * Same credential as the e-transfer inbox: `x-payments-key` names its club.
 * Off unless the admin switched reminders on — and the run is recorded either
 * way, so the admin card can tell "on, and the script is calling" from "on,
 * and nothing has asked in days" (an old script that predates reminders).
 * The response carries counts only, never names: a script is not an admin.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { groupForPaymentsKey, readPaymentsSettings, notePaymentsSettings } from '@/lib/paymentsInbox';
import { runReminders } from '@/lib/paymentReminders';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!checkRateLimit(`payments-remind:${getClientIp(req)}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const groupId = await groupForPaymentsKey(req.headers.get('x-payments-key'));
  if (!groupId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const settings = await readPaymentsSettings(groupId);
    await notePaymentsSettings(groupId, { lastReminderRunAt: new Date().toISOString() });
    if (settings?.remindersOn !== true) return NextResponse.json({ ok: true, skipped: 'off' });
    const run = await runReminders(groupId);
    return NextResponse.json({ ok: true, ...run });
  } catch (err) {
    console.error('POST /api/payments/remind failed', err);
    return NextResponse.json({ error: 'remind_failed' }, { status: 503 });
  }
}
