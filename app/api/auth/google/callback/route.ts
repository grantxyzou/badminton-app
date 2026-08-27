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
import { readOAuthCookies, classifyState, describeCallbackContext } from '@/lib/oauthState';
import { readHandoff, handoffStateMatches, isHandoffRef } from '@/lib/authHandoff';
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
  const rawState = params.get('state');
  const cookies = readOAuthCookies(req);

  /* `/start` appends `~<ref>` when the caller is a PWA that may come back in a
     different storage context. Split it off before any comparison: the cookie
     holds only the random half. */
  const sep = rawState?.indexOf('~') ?? -1;
  const state = sep >= 0 ? rawState!.slice(0, sep) : rawState;
  const handoffCandidate = sep >= 0 ? rawState!.slice(sep + 1) : null;
  const handoff = isHandoffRef(handoffCandidate) ? handoffCandidate : null;

  // The state cookie is what binds this callback to the browser that STARTED
  // the flow. Without it an attacker can complete an authorization in your
  // browser and sign you into their account (login CSRF).
  //
  // The user-facing reason stays `state_mismatch` — the distinction below is
  // for us, not them, and splitting the copy would mean two new strings in two
  // locales describing a state no correctly-working client reaches.
  const stateCheck = classifyState(cookies.state, state);

  /* THE COOKIE PATH IS PREFERRED AND UNCHANGED. Only when the cookie is absent
     — the measured signature of the iOS PWA jar split — do we fall back to the
     copy `/start` parked server-side. A `differs` is still a hard failure: that
     means the jars DO match and the value is wrong, which is the case the state
     check exists for. */
  let verifier = cookies.codeVerifier;
  if (stateCheck !== 'ok') {
    const parked = stateCheck === 'cookie_absent' && handoff ? await readHandoff(handoff) : null;
    if (!parked || !handoffStateMatches(parked.state, state)) {
      console.error(
        `[oauth-diag] google callback state=${stateCheck} handoff=${handoff ? (parked ? 'state-mismatch' : 'absent') : 'none'} ${describeCallbackContext(req)}`,
      );
      return oauthFailure(origin, 'state_mismatch');
    }
    // The parked verifier stands in for the cookie the other jar is holding.
    verifier = parked.codeVerifier;
  }
  if (!code || !verifier) return oauthFailure(origin, 'invalid_callback');

  const client = googleClient(origin);
  if (!client) return oauthFailure(origin, 'provider_not_configured');

  try {
    const tokens = await client.validateAuthorizationCode(code, verifier);
    const idToken = tokens.idToken();
    const claims = decodeIdTokenClaims(idToken);
    if (!claims.sub) return oauthFailure(origin, 'invalid_callback');

    return await finishOAuthCallback(req, origin, {
      handoff,
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
