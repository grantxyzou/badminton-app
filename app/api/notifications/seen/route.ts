/**
 * POST /api/notifications/seen — "I have looked": clears the red dot by
 * stamping the time, for this member in this club. Nothing else changes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMember } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { markNoticesSeen } from '@/lib/notices';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`notifications-seen:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;

  try {
    const seenAt = await markNoticesSeen(resolveGroupId(req), gate.member.memberId);
    return NextResponse.json({ seenAt });
  } catch (error) {
    console.error('POST notifications/seen error:', error);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
