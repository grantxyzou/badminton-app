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
import { resolveGroupId } from '@/lib/groupContext';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
/**
 * Sized against the POLL, not plucked from the other routes.
 *
 * `AskAccessSheet` polls every 3s and the request TTL is an hour, deliberately
 * — it is waiting on a human noticing a notification. At 120/hr the device
 * exhausted its own budget in SIX MINUTES, after which every poll 429s; the
 * sheet treats a non-ok response as transient and keeps waiting, so an approval
 * at minute ten was never observed and the player sat on "you'll be signed in
 * as soon as he approves" forever.
 *
 * 1200/hr covers a full hour of 3s polling with headroom, and the key is the
 * NAME rather than the IP so several phones on one gym WiFi do not share a
 * budget. The name is not a credential here — nothing is granted without the
 * secret — so keying on it costs nothing and stops one device starving another.
 */
const CLAIMS_PER_HOUR = 1400;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = body && typeof body.name === 'string' ? body.name.trim() : '';
  const secret = body && typeof body.secret === 'string' ? body.secret : '';
  if (!name || !secret) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  // Keyed per name so one device cannot starve another on the same WiFi. The
  // IP is still in the key so a single host cannot poll for every name at once.
  const ip = getClientIp(req);
  if (!checkRateLimit(`access-claim:${name.toLowerCase()}:${ip}`, CLAIMS_PER_HOUR, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  try {
    /**
     * ONE ANSWER FOR EVERY NOT-APPROVED CASE, and `none` is that answer.
     *
     * The first cut returned `pending` for an unknown name and `none` for a
     * real member with no open request — which is the overwhelmingly common
     * case — so an unauthenticated caller could ask "does member X exist?" and
     * read it straight off the status, 120 times an hour. That inverts the
     * anti-enumeration invariant the sibling route spells out.
     *
     * The legitimate device is unaffected: it always holds a genuinely pending
     * request, so it still sees `pending` until approval.
     */
    const memberId = await resolveActiveMemberId(resolveGroupId(req), name);
    if (!memberId) return NextResponse.json({ status: 'none' });

    const container = getContainer('members');
    const { resource: member } = await container.item(memberId, memberId).read<Member>();
    if (!member) return NextResponse.json({ status: 'none' });

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
      setMemberCookie(res, member.id, member.name, resolveGroupId(req));
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
