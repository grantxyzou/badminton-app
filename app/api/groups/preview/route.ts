/**
 * `GET /api/groups/preview?token=…` or `?code=…` — "which club is this?"
 *
 * THE ONE UNAUTHENTICATED ROUTE IN THE GROUP API, and necessarily so: someone
 * holding an invite link has not joined anything yet, and a join sheet that
 * cannot say whose club it is asks people to accept an invitation blind.
 *
 * It answers with the group's NAME AND NOTHING ELSE. Not the roster, not the
 * member count, not the owner, not the id. A valid token that leaked how big a
 * club is would make this an enumeration surface; the name is the minimum that
 * makes the sheet honest, so the name is all it returns.
 *
 * EVERY FAILURE ANSWERS THE SAME 404 — no such token, a token retired by a
 * regenerate, a closed group, a malformed parameter. That is `claimMigration`'s
 * rule (absent, expired and already-used are indistinguishable) applied to a
 * long-lived credential: a probe that could tell "wrong code" from "right code,
 * dead group" would confirm which codes exist, which is exactly what a guesser
 * is looking for.
 *
 * The per-IP rate limit is the whole defence for the 8-character code, the same
 * argument `lib/authMigration.ts` makes for its 6 digits. It runs before
 * anything else touches the database (rule 4).
 */
import { NextRequest, NextResponse } from 'next/server';
import { readGroup } from '@/lib/groups';
import { resolveInvite } from '@/lib/invites';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { groupsOn, featureOff, rateLimited } from '@/lib/groupRoutes';

export const dynamic = 'force-dynamic';

/** One shape for every miss. Callers must not branch on the reason. */
function noSuchInvite(): NextResponse {
  return NextResponse.json({ error: 'invite_not_found' }, { status: 404 });
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`groups-preview:${ip}`, 20, 10 * 60 * 1000)) return rateLimited();
  if (!groupsOn()) return featureOff();

  const token = req.nextUrl.searchParams.get('token');
  const code = req.nextUrl.searchParams.get('code');
  if ((!token && !code) || (token && code)) return noSuchInvite();

  try {
    const groupId = token ? await resolveInvite(token, 'invite') : await resolveInvite(code!, 'code');
    if (!groupId) return noSuchInvite();
    const group = await readGroup(groupId);
    if (!group || group.closedAt) return noSuchInvite();
    return NextResponse.json({ name: group.name });
  } catch (error) {
    console.error('GET /api/groups/preview:', error);
    return NextResponse.json({ error: 'preview_failed' }, { status: 500 });
  }
}
