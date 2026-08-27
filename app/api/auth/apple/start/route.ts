/**
 * GET /api/auth/apple/start — begin the Sign in with Apple handshake.
 *
 * Differs from Google in two ways that matter:
 *
 * 1. `response_mode=form_post`. Requesting the `name` or `email` scope forces
 *    it, and Apple then POSTs the result cross-site. That is why the state
 *    cookie is written in `form_post` mode (SameSite=None; Secure) — a
 *    cross-site POST strips even Lax.
 * 2. No PKCE verifier. Apple's web flow authenticates the client with an ES256
 *    JWT client secret instead, which `arctic` generates from the `.p8` key.
 *
 * Because the state cookie must be Secure, **this flow cannot run over
 * http://localhost** — see docs/auth-provider-setup.md.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { appOrigin, appleClient } from '@/lib/oauthProviders';
import { createState, setOAuthCookies } from '@/lib/oauthState';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`oauth-start:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  const origin = appOrigin(req.url);
  const client = appleClient(origin);
  if (!client) {
    return NextResponse.json({ error: 'provider_not_configured' }, { status: 503 });
  }

  const state = createState();
  const url = client.createAuthorizationURL(state, ['name', 'email']);
  // Requesting any scope obliges form_post; Apple rejects the request otherwise.
  url.searchParams.set('response_mode', 'form_post');

  const res = NextResponse.redirect(url.toString());
  setOAuthCookies(res, 'form_post', { state });
  return res;
}
