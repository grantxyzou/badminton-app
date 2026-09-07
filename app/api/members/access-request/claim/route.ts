/**
 * POST /api/members/access-request/claim — the asking device redeems approval.
 *
 * Polled by the device that created the request. Two things must both hold: the
 * secret proves this is that device, and `approvedAt` proves a human said yes.
 * Neither alone is enough, which is what keeps a blind one-tap approval safe.
 *
 * Single use — the request is cleared on success, so a replayed secret finds
 * nothing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { canClaim, isPending } from '@/lib/accessRequest';
import { setMemberCookie } from '@/lib/auth';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
/** Generous: the device polls while the player waits for a human. */
const CLAIMS_PER_HOUR = 120;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`access-claim:${ip}`, CLAIMS_PER_HOUR, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const name = body && typeof body.name === 'string' ? body.name.trim() : '';
  const secret = body && typeof body.secret === 'string' ? body.secret : '';
  if (!name || !secret) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const memberId = await resolveActiveMemberId(name);
    if (!memberId) {
      // Same shape as "not approved yet" — see the enumeration note on the
      // sibling route. A missing member is indistinguishable from a waiting one.
      return NextResponse.json({ status: 'pending' });
    }

    const container = getContainer('members');
    const { resource: member } = await container.item(memberId, memberId).read<Member>();
    if (!member) return NextResponse.json({ status: 'pending' });

    const stored = member.accessRequest;

    if (canClaim(stored, secret)) {
      // Burn it BEFORE signing anyone in, so a replay finds nothing even if
      // the response is lost in flight.
      const { accessRequest: _used, ...rest } = member;
      await container.items.upsert(rest);

      const res = NextResponse.json({
        status: 'approved',
        name: member.name,
        /* The client uses this to decide whether to offer a PIN afterwards.
           Someone who never had one should be asked if they want one; someone
           who forgot theirs already knows what a PIN is. */
        hasPin: typeof member.pinHash === 'string' && member.pinHash.length > 0,
      });
      setMemberCookie(res, member.id, member.name);
      return res;
    }

    // Still waiting, expired, or the wrong secret — all one answer, because a
    // probe must not be able to tell them apart.
    return NextResponse.json({ status: isPending(stored) ? 'pending' : 'none' });
  } catch (err) {
    console.error('POST /api/members/access-request/claim failed:', err);
    return NextResponse.json({ error: 'claim_failed' }, { status: 503 });
  }
}
