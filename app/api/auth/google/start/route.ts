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
import { beginHandoff, isHandoffRef } from '@/lib/authHandoff';

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

  /* An installed iOS PWA sends `?hr=<sha256>` — see lib/authHandoff.ts. The
     excursion leaves its webview, so neither cookie set below will reach the
     callback; park their contents server-side against that ref instead. The
     ref is a HASH, so nothing here becomes a credential if the URL leaks.

     A refused begin (a live stash already holds this ref) is NOT fatal: the
     cookies below still work for every browser that keeps one jar, so the
     flow degrades to exactly today's behaviour rather than dead-ending. */
  const hr = new URL(req.url).searchParams.get('hr');
  const handoff = isHandoffRef(hr) ? hr : null;
  if (handoff) {
    try {
      await beginHandoff(handoff, { state, codeVerifier });
    } catch (err) {
      console.error('handoff begin failed:', err);
    }
  }

  // The ref rides in `state` so it survives the round trip through Google
  // without needing a cookie. Separator is `~`, which is unreserved in a URL
  // and cannot appear in either hex half.
  const outboundState = handoff ? `${state}~${handoff}` : state;
  const url = client.createAuthorizationURL(outboundState, codeVerifier, ['openid', 'profile', 'email']);
  url.searchParams.set('prompt', 'select_account');

  const res = NextResponse.redirect(url.toString());
  // Still set, and still preferred: a browser with one jar takes this path and
  // never touches the handoff store.
  setOAuthCookies(res, 'redirect', { state, codeVerifier });
  return res;
}
