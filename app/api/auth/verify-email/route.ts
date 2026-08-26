/**
 * GET /api/auth/verify-email?token=&email= — redeem an emailed verification link.
 *
 * REDIRECTS RATHER THAN RETURNING JSON, in both the success and failure cases.
 * This URL is opened from a mail client by a person, not by fetch(): a raw
 * `{"error":"invalid_token"}` page is a dead end with no way back into the app.
 * The app reads `?verified=1|0` on Home and says something useful.
 *
 * Verification is what makes `emailVerified` trustworthy, which matters beyond
 * this route: the OAuth resolution table will link a provider identity to an
 * existing member when BOTH sides assert a verified address. An unverified
 * `email` field is just a claim, and must never be treated as proof.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { checkToken } from '@/lib/authToken';
import { normalizeEmail, lookupIdentity } from '@/lib/authIdentity';
import { outboundOriginOrNull } from '@/lib/appOrigin';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

function landing(req: NextRequest, ok: boolean): NextResponse {
  // Same rule as the emailed links: never trust the request's own origin.
  // A relative redirect is the safe fallback -- the browser resolves it
  // against whatever host it actually reached, with nothing attacker-supplied
  // baked in by us.
  const origin = outboundOriginOrNull();
  const target = `${origin ?? ''}/bpm?verified=${ok ? '1' : '0'}`;
  return NextResponse.redirect(origin ? target : new URL(target, req.url));
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-verify:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  const params = new URL(req.url).searchParams;
  const token = params.get('token') ?? '';
  const email = normalizeEmail(params.get('email') ?? '');
  if (!token || !email) return landing(req, false);

  try {
    const identity = await lookupIdentity('email', email);
    if (!identity) return landing(req, false);

    const container = getContainer('members');
    const { resource: member } = await container
      .item(identity.memberId, identity.memberId)
      .read<Member>();
    if (!member || member.active !== true) return landing(req, false);

    // Already verified is a SUCCESS, not an error. People re-tap links, and
    // telling someone their confirmed address failed to confirm is a worse lie
    // than saying yes twice.
    if (member.emailVerified === true && !member.emailVerification) {
      return landing(req, true);
    }

    if (!checkToken(token, member.emailVerification)) return landing(req, false);

    // Deleting the record is what makes the link single-use — `checkToken`
    // holds no state of its own.
    const { emailVerification: _consumed, ...rest } = member;
    await container.items.upsert({ ...rest, emailVerified: true });
    return landing(req, true);
  } catch (err) {
    console.error('GET /api/auth/verify-email unhandled:', err);
    return landing(req, false);
  }
}
