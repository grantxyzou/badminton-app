import { NextRequest, NextResponse } from 'next/server';
import { isInviteToken } from '@/lib/inviteLink';

/**
 * GET /bpm/j/<token>: the one invite link, answered on the WEBSITE.
 *
 * The full app and (later) the App Clip open this URL themselves. Everywhere
 * else it lands here, and all this does is send the browser to the `?join=`
 * page that has always taken invites, so the sign-up screens, the claim rules
 * and `lib/landingParams.ts` are untouched. It reads nothing and stores
 * nothing: the invite is checked where it always was, by the preview and the
 * sign-up.
 *
 * A malformed token goes to the same place with a token that can never match,
 * so the person sees the one "used or expired" message every failed invite
 * gets, rather than a bare welcome page or their own input echoed back.
 *
 * The redirect is RELATIVE, as in `app/api/auth/verify-email/route.ts`: the
 * browser resolves it against the host it actually reached, and no request
 * header is baked into the link. 303 so no method can be carried over.
 * `no-store` because the token is a bearer credential until it is used. The
 * referrer needs nothing here: the site-wide `strict-origin-when-cross-origin`
 * (`next.config.js`) already sends no path to another site, and setting a
 * header on this response would be overwritten by it anyway.
 */
export const dynamic = 'force-dynamic';

/** Valid hex, so it reaches the preview, and minted by nothing, so it 404s there. */
const NEVER_A_TOKEN = '0'.repeat(32);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token: raw } = await ctx.params;
  const token = isInviteToken(raw) ? raw.toLowerCase() : NEVER_A_TOKEN;
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: `/bpm?join=${token}`,
      'Cache-Control': 'no-store',
    },
  });
}
