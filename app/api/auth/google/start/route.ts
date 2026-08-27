/**
 * GET /api/auth/google/start — begin the Google handshake.
 *
 * Mints a CSRF state and a PKCE verifier, parks both in short-lived cookies,
 * and redirects to Google. The callback is where anything interesting happens.
 *
 * `prompt=select_account` is deliberate: without it Google silently reuses the
 * only signed-in account, which on a shared phone signs you in as whoever used
 * it last with no visible choice.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { appOrigin, googleClient } from '@/lib/oauthProviders';
import { createState, createCodeVerifier, setOAuthCookies } from '@/lib/oauthState';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`oauth-start:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  // appOrigin THROWS when APP_ORIGIN is unset outside local dev (deliberate --
  // see lib/appOrigin.ts). Unguarded, that 500s before reaching the
  // provider_not_configured answer below, turning a plain misconfiguration
  // into an opaque server error.
  let origin: string;
  try {
    origin = appOrigin(req.url);
  } catch {
    return NextResponse.json({ error: 'provider_not_configured' }, { status: 503 });
  }
  const client = googleClient(origin);
  if (!client) {
    // Configured-or-not is a first-class state: a deployment without Google
    // credentials says so, rather than redirecting into a broken consent page.
    return NextResponse.json({ error: 'provider_not_configured' }, { status: 503 });
  }

  const state = createState();
  const codeVerifier = createCodeVerifier();
  const url = client.createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email']);
  url.searchParams.set('prompt', 'select_account');

  const res = NextResponse.redirect(url.toString());
  setOAuthCookies(res, 'redirect', { state, codeVerifier });
  return res;
}
