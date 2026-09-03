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
 *
 * THE HANDOFF IS THE SAME AS GOOGLE'S. It was not, for the first two weeks:
 * this route never read `?hr=`, so an installed iOS PWA that picked Apple
 * signed Safari in and came back to the app signed out — the exact symptom
 * `lib/authHandoff.ts` was written to fix, on the one provider it skipped.
 * Found on 2026-09-03 while planning the native shell, where the system
 * browser sheet makes the jar split unconditional.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { appOrigin, appleClient } from '@/lib/oauthProviders';
import { createState, setOAuthCookies } from '@/lib/oauthState';
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
  const client = appleClient(origin);
  if (!client) {
    return NextResponse.json({ error: 'provider_not_configured' }, { status: 503 });
  }

  const state = createState();

  /* Mirrors google/start exactly — see the comment there. Apple has no PKCE
     verifier, so the stash carries an empty one; the state is the only thing
     the absent cookie would have held. */
  const search = new URL(req.url).searchParams;
  const hr = search.get('hr');
  const handoff = isHandoffRef(hr) ? hr : null;
  const native = search.get('native') === '1';
  if (handoff) {
    try {
      await beginHandoff(handoff, { state, codeVerifier: '', native });
    } catch (err) {
      console.error('handoff begin failed:', err);
    }
  }

  // The ref rides in `state` so it survives the round trip through Apple
  // without needing a cookie. `~` is unreserved and cannot appear in either
  // hex half. Apple echoes `state` verbatim in the form post.
  const outboundState = handoff ? `${state}~${handoff}` : state;
  const url = client.createAuthorizationURL(outboundState, ['name', 'email']);
  // Requesting any scope obliges form_post; Apple rejects the request otherwise.
  url.searchParams.set('response_mode', 'form_post');

  const res = NextResponse.redirect(url.toString());
  setOAuthCookies(res, 'form_post', { state });
  return res;
}
