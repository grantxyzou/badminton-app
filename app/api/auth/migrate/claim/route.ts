/**
 * POST /api/auth/migrate/claim — redeem a migration link or short code in the
 * NATIVE shell and become that member here.
 *
 * Body: `{ link }` (the 64-hex code from the universal link) or
 * `{ name, short }` (the 6-digit code typed by hand).
 *
 * THE deleteToken RE-MINT IS MANDATORY, NOT A NICETY. `DELETE /api/players`
 * accepts admin or `deleteToken` but never `member_session`, so a migrated
 * member would be signed in yet unable to cancel their own spot. The token
 * is `randomBytes(16)` on the Player doc — random, not derivable — so it has
 * to be minted fresh, exactly as `app/api/players/recover/route.ts` does when
 * any credential is presented. `null` means "authenticated but not registered
 * for the active session", same as the PIN sign-in path.
 *
 * The rate limit is the whole defence for the short code: 10^6 possibilities,
 * a five-minute window, ten tries an hour per IP.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { completeSignIn } from '@/lib/authSession';
import { claimMigration, type ClaimInput } from '@/lib/authMigration';
import type { Member, Player } from '@/lib/types';

export const dynamic = 'force-dynamic';

function parseInput(body: unknown): ClaimInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { link?: unknown; name?: unknown; short?: unknown };
  if (typeof b.link === 'string' && b.name === undefined && b.short === undefined) {
    return { link: b.link.trim() };
  }
  if (typeof b.name === 'string' && typeof b.short === 'string' && b.link === undefined) {
    return { name: b.name.trim().slice(0, 100), short: b.short.trim() };
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_NATIVE_MIGRATE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`migrate-claim:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const input = parseInput(body);
  if (!input) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  try {
    const claim = await claimMigration(input);
    // Absent, expired and already-used are ONE answer, by design.
    if (claim.status !== 'ready') return NextResponse.json({ status: 'none' }, { status: 404 });

    const { resource: member } = await getContainer('members')
      .item(claim.memberId, claim.memberId)
      .read<Member>();
    if (!member || member.active !== true) {
      return NextResponse.json({ error: 'account_unavailable' }, { status: 403 });
    }

    // Re-mint deleteToken when a session player exists — the precedent is
    // app/api/players/recover/route.ts, kept the same shape on purpose.
    const sessionId = await getActiveSessionId();
    const playersContainer = getContainer('players');
    const { resources: playerHits } = await playersContainer.items
      .query({
        query:
          'SELECT * FROM c WHERE c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name) AND (NOT IS_DEFINED(c.removed) OR c.removed != true)',
        parameters: [
          { name: '@sessionId', value: sessionId },
          { name: '@name', value: member.name },
        ],
      })
      .fetchAll();
    const player = (playerHits[0] as Player | undefined) ?? null;

    let deleteToken: string | null = null;
    if (player) {
      deleteToken = randomBytes(16).toString('hex');
      await playersContainer.items.upsert({ ...player, deleteToken });
    }

    // Never spread the member doc into the response (strip canary).
    const res = NextResponse.json({
      status: 'ready',
      name: member.name,
      memberId: member.id,
      deleteToken,
      sessionId,
    });
    // ORDER: every `cookies.set` BEFORE completeSignIn — its clearAdminCookie
    // branch appends raw Set-Cookie headers that a later `.set()` drops
    // (__tests__/auth-cookie-order.test.ts).
    if (claim.locale === 'en' || claim.locale === 'zh-CN') {
      res.cookies.set({
        name: 'NEXT_LOCALE',
        value: claim.locale,
        path: '/bpm',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    }
    completeSignIn(res, { id: member.id, name: member.name, role: member.role });
    return res;
  } catch (err) {
    console.error('POST /api/auth/migrate/claim failed:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
