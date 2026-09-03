/**
 * POST /api/auth/migrate/start — mint a one-time link + short code that
 * carries THIS signed-in member into the native shell.
 *
 * Requires a live `member_session`: the code is a bearer credential for five
 * minutes, so it can be stolen in flight but never forged. Returns the codes
 * ONCE; only their hashes are stored. See lib/authMigration.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { verifyMemberAuth } from '@/lib/auth';
import { getContainer } from '@/lib/cosmos';
import { requireOutboundOrigin } from '@/lib/appOrigin';
import { mintMigration } from '@/lib/authMigration';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_NATIVE_MIGRATE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Rate limit before auth (security rule 4). Minting is cheap but each mint
  // is a live credential; ten an hour is plenty for "the link expired".
  const ip = getClientIp(req);
  if (!checkRateLimit(`migrate-start:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  const session = verifyMemberAuth(req);
  if (!session) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  // The link is delivered out of band (tapped on the same phone, or read
  // aloud), so it is an OUTBOUND link: never built from the request Host.
  let origin: string;
  try {
    origin = requireOutboundOrigin();
  } catch {
    return NextResponse.json({ error: 'misconfigured' }, { status: 503 });
  }

  try {
    const { resource: member } = await getContainer('members')
      .item(session.memberId, session.memberId)
      .read<Member>();
    if (!member || member.active !== true) {
      return NextResponse.json({ error: 'account_unavailable' }, { status: 403 });
    }

    const locale = req.cookies.get('NEXT_LOCALE')?.value;
    const minted = await mintMigration({ id: member.id, name: member.name }, locale);
    return NextResponse.json({
      ...minted,
      link: `${origin}/bpm/migrate?c=${minted.linkCode}`,
    });
  } catch (err) {
    console.error('POST /api/auth/migrate/start failed:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
