/**
 * Everything a provider callback does AFTER the code exchange.
 *
 * Google and Apple differ only in how the code arrives (query string vs
 * form-post body) and how it is exchanged. From verified claims onward the
 * behaviour must be identical, so it lives here once — a second copy is how
 * one provider quietly grows a weaker linking rule than the other.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { completeSignIn } from '@/lib/authSession';
import { verifyMemberAuth } from '@/lib/auth';
import { resolveOAuthIdentity } from '@/lib/authResolve';
import {
  normalizeEmail,
  lookupIdentity,
  reserveIdentity,
  touchIdentity,
  type AuthProvider,
} from '@/lib/authIdentity';
import { setPendingSignup } from '@/lib/pendingSignup';
import { clearOAuthCookies } from '@/lib/oauthState';
import { completeHandoff } from '@/lib/authHandoff';
import type { Member } from '@/lib/types';

export interface ProviderClaims {
  provider: Extract<AuthProvider, 'google' | 'apple'>;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  /** Apple sends this on the FIRST authorization only. Google never does. */
  suggestedName: string | null;
  /**
   * Present when the flow began in a storage context that will not receive this
   * response's cookies — an installed iOS PWA. The resolved member is parked
   * against this ref for the app to collect instead. See lib/authHandoff.ts.
   */
  handoff?: string | null;
}

/**
 * Where the browser is sent once the handshake is over, win or lose.
 *
 * THE TRAILING SLASH IS LOAD-BEARING, and its absence was a live bug on iOS.
 *
 * The Web App Manifest declares `scope: "/bpm/"`. Manifest scope is a PATH
 * PREFIX match, so `/bpm` — no slash — is NOT inside `/bpm/`; `/bpm/` is. This
 * function used to return the former, which meant every provider sign-in
 * deliberately landed the user outside the app's own declared scope.
 *
 * On an installed iOS PWA that is not cosmetic. iOS resolves the whole redirect
 * chain and, finding it ends out of scope, keeps the entire excursion in the
 * in-app Safari view rather than handing back to the PWA. The callback request
 * is therefore issued by SAFARI — a separate cookie container, which never saw
 * the `bpm_oauth_state` cookie that `/start` set inside the PWA. The result was
 * a deterministic `state_mismatch` on every attempt, and the user stranded in a
 * browser afterwards. One missing character, both symptoms.
 *
 * It could not be caught by the suite: the mock store never performs a
 * cross-origin redirect and nothing in vitest models manifest scope. The canary
 * in __tests__/oauth-landing-scope.test.ts asserts the invariant directly
 * instead — that this URL is inside the manifest's own scope.
 */
function landing(origin: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${origin}/bpm/?${qs}`;
}

/**
 * 303 See Other, not Next's default 307.
 *
 * 307 PRESERVES THE REQUEST METHOD. Apple's callback arrives as a cross-site
 * POST (`response_mode=form_post`), so a 307 tells the browser to re-issue that
 * POST — form body and all — against `/bpm/`, which is not a POST handler. Every
 * Apple sign-in would dead-end at a method mismatch, success or failure alike.
 *
 * 303 is the status that exists for exactly this: "your POST is done, go GET
 * the result." Harmless for Google's GET callback, so both use it.
 */
function seeOther(url: string): NextResponse {
  return NextResponse.redirect(url, { status: 303 });
}

/** Redirect home with a machine-readable reason the UI can render. */
export function oauthFailure(origin: string, reason: string): NextResponse {
  const res = seeOther(landing(origin, { authError: reason }));
  clearOAuthCookies(res);
  return res;
}

/**
 * Look up the facts the resolution table needs, apply it, and act.
 *
 * The lookups live here and the DECISION lives in `lib/authResolve.ts`, which
 * is pure and exhaustively tested. The mock store cannot perform a cross-site
 * redirect, so no test can prove the handshake — keeping the decision separate
 * is what makes the security-critical half provable at all.
 */
export async function finishOAuthCallback(
  req: NextRequest,
  origin: string,
  claims: ProviderClaims,
): Promise<NextResponse> {
  const container = getContainer('members');
  const email = claims.email ? normalizeEmail(claims.email) : null;

  const existing = await lookupIdentity(claims.provider, claims.sub);

  // Only a VERIFIED address on our side may be used to link. An unverified
  // `email` on a member is a claim the member typed, not proof — treating it
  // as proof would let anyone claim an account by signing up with its address.
  let memberIdByVerifiedEmail: string | null = null;
  if (email) {
    const emailIdentity = await lookupIdentity('email', email);
    if (emailIdentity) {
      const { resource } = await container
        .item(emailIdentity.memberId, emailIdentity.memberId)
        .read<Member>();
      if (resource?.active === true && resource.emailVerified === true) {
        memberIdByVerifiedEmail = resource.id;
      }
    }
  }

  const action = resolveOAuthIdentity({
    existingIdentityMemberId: existing?.memberId ?? null,
    sessionMemberId: verifyMemberAuth(req)?.memberId ?? null,
    providerEmail: email,
    providerEmailVerified: claims.emailVerified,
    memberIdByVerifiedEmail,
  });

  if (action.kind === 'new-account') {
    // Needs a display name from the user, and must refuse names already taken —
    // so it cannot finish here. Park the verified facts in a SIGNED cookie and
    // let /api/auth/complete-signup finish once a name is chosen.
    const res = seeOther(landing(origin, { authFlow: 'name' }));
    setPendingSignup(res, {
      provider: claims.provider,
      sub: claims.sub,
      email,
      emailVerified: claims.emailVerified,
      suggestedName: claims.suggestedName,
    });
    clearOAuthCookies(res);
    return res;
  }

  const { resource: member } = await container
    .item(action.memberId, action.memberId)
    .read<Member>();
  if (!member || member.active !== true) return oauthFailure(origin, 'account_unavailable');

  if (action.kind === 'link') {
    const reserved = await reserveIdentity(claims.provider, claims.sub, member.id);
    if (!reserved.ok) {
      // Someone else already holds this provider identity. Never steal it.
      return oauthFailure(origin, 'already_linked');
    }
    const linked = new Set([...(member.linkedProviders ?? []), claims.provider]);
    await container.items.upsert({
      ...member,
      linkedProviders: [...linked],
      // Linking does NOT confer verification: rule 3 already required a
      // verified address on both sides, and rules 1-2 did not check one at all.
    });
  } else {
    void touchIdentity(claims.provider, claims.sub);
  }

  /* THE JAR SPLIT. `completeSignIn` below sets `member_session` on THIS
     response — which, for a PWA-initiated flow, is being issued to Safari. The
     cookie would land in the wrong jar and the app would stay signed out, which
     is the actual reported symptom ("still shows the safari shell").

     So park the resolved member against the ref instead. The cookies are still
     set: this response is a real browser session too, and signing Safari in as
     well costs nothing. The landing tells the person to go back to the app,
     because nothing on iOS will do it for them. */
  if (claims.handoff) {
    const parked = await completeHandoff(claims.handoff, member.id);
    if (parked) {
      const res = seeOther(landing(origin, { signedIn: '1', provider: claims.provider }));
      clearOAuthCookies(res);
      completeSignIn(res, member);
      return res;
    }
    // Parking failed (expired or swept). Fall through: Safari is still signed
    // in, which is better than an error, and the app will simply not collect.
  }

  const res = seeOther(landing(origin, { signedIn: '1', provider: claims.provider }));
  // ORDER: every `cookies.set` must happen BEFORE completeSignIn. Its
  // clearAdminCookie branch APPENDS raw Set-Cookie headers, and a later
  // `.set()` re-serializes the whole cookie map and silently drops them --
  // leaving a stale admin_session alive for a non-admin. Verified, and
  // pinned by __tests__/auth-cookie-order.test.ts.
  clearOAuthCookies(res);
  completeSignIn(res, member);
  return res;
}
