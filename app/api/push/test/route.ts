import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { sendPushToMembers, isPushConfigured } from '@/lib/push';
import { buildTestPayload } from '@/lib/pushMessages';

export const dynamic = 'force-dynamic';

/**
 * Admin transport self-test.
 *
 * This exists so the hard parts of Web Push — service-worker registration,
 * VAPID key agreement, and the iOS installed-PWA requirement — can be proven on
 * a real device BEFORE any trigger is wired up. If this returns sent >= 1 and a
 * banner appears, the transport is good and any later failure is a trigger bug.
 *
 * Deliberately targets ONLY the calling admin's own devices: a "test" that
 * broadcasts to the whole friend group is not a test.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`push-test:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PUSH_NOTIFY')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Sends cost real quota, so use the fresh role re-check rather than the cheap
  // signature-only variant.
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  // Report an unconfigured server explicitly instead of a confusing sent: 0 —
  // "nothing happened" has two very different causes and the admin needs to
  // know which one they hit.
  if (!isPushConfigured()) {
    return NextResponse.json({ error: 'push_not_configured' }, { status: 503 });
  }

  try {
    const result = await sendPushToMembers([auth.memberId], buildTestPayload());
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('POST push/test error:', error);
    return NextResponse.json({ error: 'send_failed' }, { status: 500 });
  }
}
