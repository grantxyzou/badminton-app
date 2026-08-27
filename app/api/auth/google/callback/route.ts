/**
 * GET /api/auth/google/callback — Google's redirect back into the app.
 *
 * Everything from verified claims onward is shared with Apple in
 * `lib/oauthCallback.ts`. This route owns only the Google-specific parts: the
 * query-string shape and the PKCE code exchange.
 *
 * Failures redirect home with `?authError=<reason>` rather than rendering JSON.
 * A person arrives here from a browser navigation, not a fetch, so a raw error
 * document is a dead end.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { appOrigin, googleClient, decodeIdTokenClaims } from '@/lib/oauthProviders';
import { readOAuthCookies, verifyState } from '@/lib/oauthState';
import { finishOAuthCallback, oauthFailure } from '@/lib/oauthCallback';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // appOrigin THROWS when APP_ORIGIN is unset outside local dev. Unguarded,
  // that 500s before ANY of this route's oauthFailure redirects can run -- and
  // oauthFailure itself needs an origin to redirect to, so the fallback is a
  // relative landing the browser resolves against whatever host it reached.
  let origin: string;
  try {
    origin = appOrigin(req.url);
  } catch {
    return NextResponse.redirect(new URL('/bpm?authError=misconfigured', req.url), {
      status: 303,
    });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`oauth-callback:${ip}`, 10, 60 * 60 * 1000)) {
    return oauthFailure(origin, 'rate_limited');
  }

  const params = new URL(req.url).searchParams;
  // The user pressed Cancel on Google's consent screen. Not an error worth
  // shouting about — send them home quietly.
  if (params.get('error')) return oauthFailure(origin, 'cancelled');

  const code = params.get('code');
  const state = params.get('state');
  const cookies = readOAuthCookies(req);

  // The state cookie is what binds this callback to the browser that STARTED
  // the flow. Without it an attacker can complete an authorization in your
  // browser and sign you into their account (login CSRF).
  if (!verifyState(cookies.state, state)) return oauthFailure(origin, 'state_mismatch');
  if (!code || !cookies.codeVerifier) return oauthFailure(origin, 'invalid_callback');

  const client = googleClient(origin);
  if (!client) return oauthFailure(origin, 'provider_not_configured');

  try {
    const tokens = await client.validateAuthorizationCode(code, cookies.codeVerifier);
    const idToken = tokens.idToken();
    const claims = decodeIdTokenClaims(idToken);
    if (!claims.sub) return oauthFailure(origin, 'invalid_callback');

    return await finishOAuthCallback(req, origin, {
      provider: 'google',
      sub: claims.sub,
      email: claims.email,
      emailVerified: claims.emailVerified,
      // Google never returns a name we are willing to trust as a display name;
      // the user picks one on the next screen.
      suggestedName: null,
    });
  } catch (err) {
    console.error('google callback failed:', err);
    return oauthFailure(origin, 'exchange_failed');
  }
}
