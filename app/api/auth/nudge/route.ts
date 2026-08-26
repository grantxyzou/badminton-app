/**
 * POST /api/auth/nudge — record that the caller dismissed the upgrade nudge.
 *
 * Stored on the MEMBER rather than in localStorage. A per-device dismissal
 * would re-nag the same person on their phone, their laptop and every private
 * window — which reads as the app not listening.
 *
 * Identity comes from the `member_session` cookie. A name-keyed version would
 * let anyone silence anyone else's prompt, which is petty rather than
 * dangerous, but is still a write on someone else's record.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { verifyMemberAuth } from '@/lib/auth';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-nudge:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  const auth = verifyMemberAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const container = getContainer('members');
    const { resource: member } = await container
      .item(auth.memberId, auth.memberId)
      .read<Member>();
    if (!member || member.active !== true) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    await container.items.upsert({
      ...member,
      authNudge: { dismissedAt: new Date().toISOString() },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/nudge unhandled:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
