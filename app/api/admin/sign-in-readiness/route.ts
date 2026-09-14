/**
 * `GET /api/admin/sign-in-readiness` — how many members could sign in if
 * members-only were on today, and who could not (docs/plans/members-only.md).
 *
 * THE ASYNC ADMIN CHECK, ON A READ, ON PURPOSE. The repo's convention lets a
 * read-only admin route use the cheap sync check, but what this returns is a
 * list of the accounts with no credential at all — the unclaimed ones, the
 * cheapest to take over. `members/me` withholds exactly that from unproven
 * callers. A demoted admin holding a 30-day cookie must not read it on their way
 * out, the same reasoning `groups/invite` gives for its GET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { readSignInReadiness } from '@/lib/signInReadiness';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`sign-in-readiness:${ip}`, 60, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  try {
    return NextResponse.json(await readSignInReadiness(auth.groupId));
  } catch (error) {
    // Legible-fail: a failed read must not look like "everyone can sign in".
    console.error('GET /api/admin/sign-in-readiness:', error);
    return NextResponse.json({ error: 'readiness_failed' }, { status: 503 });
  }
}
