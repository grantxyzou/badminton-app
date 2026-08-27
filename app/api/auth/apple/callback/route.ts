/**
 * POST /api/auth/apple/callback — Apple's form-post back into the app.
 *
 * A POST, not a GET, because Apple uses `response_mode=form_post`. The body is
 * `application/x-www-form-urlencoded`, not JSON.
 *
 * THE ONE-SHOT NAME
 * -----------------
 * Apple sends the user's name in the form body on the VERY FIRST authorization
 * and never again — not in the id_token, and not on any later sign-in. If it is
 * not captured at this exact moment it is gone permanently; the only way to get
 * another chance is for the user to remove the app from their Apple ID and
 * re-authorize. So it is read before anything that can fail, and carried into
 * the pending-signup cookie.
 *
 * Apple private-relay addresses (`…@privaterelay.appleid.com`) also mean the
 * email is not a human-readable identifier. It is stored, but never shown as a
 * display name.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { appOrigin, appleClient, decodeIdTokenClaims } from '@/lib/oauthProviders';
import { readOAuthCookies, verifyState } from '@/lib/oauthState';
import { finishOAuthCallback, oauthFailure } from '@/lib/oauthCallback';

export const dynamic = 'force-dynamic';

/**
 * Apple's `user` field is a JSON string, present only on first authorization.
 * Exported for tests: this parse is the last chance to capture a name Apple
 * will never send again, so it is worth exercising directly rather than only
 * through a flow that needs a live token exchange.
 */
export function readOneShotName(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { name?: { firstName?: string; lastName?: string } };
    const first = parsed.name?.firstName?.trim() ?? '';
    const last = parsed.name?.lastName?.trim() ?? '';
    const full = `${first} ${last}`.trim();
    return full || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const origin = appOrigin(req.url);

  const ip = getClientIp(req);
  if (!checkRateLimit(`oauth-callback:${ip}`, 10, 60 * 60 * 1000)) {
    return oauthFailure(origin, 'rate_limited');
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return oauthFailure(origin, 'invalid_callback');
  }

  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v : null;
  };

  if (str('error')) return oauthFailure(origin, 'cancelled');

  // Read FIRST — see the one-shot note above.
  const suggestedName = readOneShotName(str('user'));

  const code = str('code');
  const state = str('state');
  const cookies = readOAuthCookies(req);

  // If this fails in production, the usual cause is the state cookie not
  // surviving the cross-site POST — i.e. it was not written SameSite=None;
  // Secure. See lib/oauthState.ts.
  if (!verifyState(cookies.state, state)) return oauthFailure(origin, 'state_mismatch');
  if (!code) return oauthFailure(origin, 'invalid_callback');

  const client = appleClient(origin);
  if (!client) return oauthFailure(origin, 'provider_not_configured');

  try {
    const tokens = await client.validateAuthorizationCode(code);
    const claims = decodeIdTokenClaims(tokens.idToken());
    if (!claims.sub) return oauthFailure(origin, 'invalid_callback');

    return await finishOAuthCallback(req, origin, {
      provider: 'apple',
      sub: claims.sub,
      email: claims.email,
      // Apple sends email_verified as the STRING "true"; decodeIdTokenClaims
      // normalizes both forms.
      emailVerified: claims.emailVerified,
      suggestedName,
    });
  } catch (err) {
    console.error('apple callback failed:', err);
    return oauthFailure(origin, 'exchange_failed');
  }
}
