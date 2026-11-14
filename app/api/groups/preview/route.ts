/**
 * `GET /api/groups/preview?token=…` or `?claim=…` — "which club is this link for?"
 *
 * THE ONE UNAUTHENTICATED ROUTE IN THE GROUP API, and necessarily so: someone
 * holding a club's link has not joined anything yet, and a page that cannot
 * say whose club it is asks people to join blind.
 *
 * It answers with the group's NAME AND NOTHING ELSE, plus `kind: 'door'` (the
 * club's link; every link is one since one-time invites were retired in
 * docs/plans/one-way-in.md, step 5, and the field stays for older pages). Not
 * the roster, not the member count, not the owner, not the id.
 *
 * EVERY FAILURE ANSWERS THE SAME 404: no such link, a link retired by "New
 * link", a closed group, a malformed parameter, and an old invite's `?code=`.
 * A probe that could tell "wrong link" from "right link, dead group" would
 * confirm which links exist. The per-IP rate limit runs before anything else
 * touches the database (rule 4).
 */
import { NextRequest, NextResponse } from 'next/server';
import { readGroup } from '@/lib/groups';
import { resolveClaimLink } from '@/lib/claimLinks';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { rateLimited } from '@/lib/groupRoutes';

export const dynamic = 'force-dynamic';

/** One shape for every miss. Callers must not branch on the reason. */
function noSuchInvite(): NextResponse {
  return NextResponse.json({ error: 'invite_not_found' }, { status: 404 });
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`groups-preview:${ip}`, 20, 10 * 60 * 1000)) return rateLimited();

  // `/bpm/j/<token>` sends `token`; a link sent as `?claim=` sends `claim`.
  // A retired invite's `?code=` is just one more miss.
  const token = req.nextUrl.searchParams.get('token');
  const claim = req.nextUrl.searchParams.get('claim');
  const code = req.nextUrl.searchParams.get('code');
  if (code || [token, claim].filter(Boolean).length !== 1) return noSuchInvite();

  try {
    const groupId = await resolveClaimLink(token ?? claim);
    if (!groupId) return noSuchInvite();
    const group = await readGroup(groupId);
    if (!group || group.closedAt) return noSuchInvite();
    return NextResponse.json({ name: group.name, kind: 'door' as const });
  } catch (error) {
    console.error('GET /api/groups/preview:', error);
    return NextResponse.json({ error: 'preview_failed' }, { status: 500 });
  }
}
