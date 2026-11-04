/**
 * GET /api/notifications — the caller's notices in the club they are looking
 * at, newest first, with how many are unread (`docs/plans/notification-center.md`).
 *
 * Identity is the cookie's, never a parameter: a notice can say "your racket is
 * ready" or "time to settle up", which is nobody else's business.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { listNotices } from '@/lib/notices';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`notifications:${ip}`, 120, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;

  try {
    const list = await listNotices(resolveGroupId(req), gate.member.memberId);
    return NextResponse.json(list);
  } catch (error) {
    console.error('GET notifications error:', error);
    // Never an empty list on a failed read: "nothing new" is a claim.
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
