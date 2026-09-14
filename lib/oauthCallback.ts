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
import { completeHandoff, readHandoff } from '@/lib/authHandoff';
import type { Member } from '@/lib/types';
import { resolveGroupId } from '@/lib/groupContext';

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
  /**
   * The state check passed on the PARKED copy, not on this browser's cookie —
   * the jar-split signature. REQUIRED, so no caller can forget to say.
   *
   * Such a callback proves nothing about which browser STARTED the flow, so it
   * is non-authenticating: no session cookie on this response, and this
   * browser's own `member_session` is never taken as a request to link. Both
   * were an account takeover (security scan F3; F13 for Apple). The app that
   * holds the preimage gets its session from the claim route instead.
   */
  viaParkedState: boolean;
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
function landing(origin: string, params: Record<string, string>, fragment?: string): string {
  const qs = new URLSearchParams(params).toString();
  return `${origin}/bpm/?${qs}${fragment ? `#${fragment}` : ''}`;
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

  /* A flow the NATIVE shell started lands in a system-browser sheet that never
     hands back on its own, so every landing below carries `native=1` and the
     page renders a "back to the app" link. Read from the STASH, not the URL:
     the callback URL is provider-controlled. One extra point-read, only on
     handoff flows. */
  const stash = claims.handoff ? await readHandoff(claims.handoff) : null;
  const nativeParam: Record<string, string> = stash?.native ? { native: '1' } : {};

  /* The callback read this stash moments ago to validate state. If it expired
     in between, there is nothing to park into, and a parked-state callback may
     not fall back to signing this browser in. */
  if (claims.viaParkedState && !stash) return oauthFailure(origin, 'state_mismatch');

  /* THE STASH IS HONOURED ONLY WHEN THIS CALLBACK NEEDS IT (security scan F4).
     Every web flow carries `?hr=`, and the ref is chosen by whoever called
     `/start`, so completing on the cookie path would let a crafted sign-in link
     park an ordinary browser's session for the link's author to claim. Two
     cases genuinely need it: the jar split (the parked state stood in), and the
     native shell, whose sheet keeps the cookie but is not the app. The native
     case is protected by the return code `completeHandoff` mints instead. */
  const handoff = stash && (claims.viaParkedState || stash.native) ? claims.handoff! : null;

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
    // Never on a parked-state callback: this browser did not start the flow,
    // so its session is not a request to link anything to it (F3).
    sessionMemberId: claims.viaParkedState ? null : (verifyMemberAuth(req)?.memberId ?? null),
    providerEmail: email,
    providerEmailVerified: claims.emailVerified,
    memberIdByVerifiedEmail,
  });

  if (action.kind === 'new-account') {
    // Needs a display name from the user, and must refuse names already taken —
    // so it cannot finish here. Park the verified facts in a SIGNED cookie and
    // let /api/auth/complete-signup finish once a name is chosen.
    const res = seeOther(landing(origin, { authFlow: 'name', ...nativeParam }));
    setPendingSignup(res, {
      provider: claims.provider,
      sub: claims.sub,
      email,
      emailVerified: claims.emailVerified,
      suggestedName: claims.suggestedName,
      // A NEW account has no member to park yet, so the ref rides along to
      // complete-signup, which is where one first exists — under the same
      // condition as the sign-in path below, or the name step reopens F4.
      handoff,
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

  /* THE JAR SPLIT. A session cookie on this response lands in the browser that
     COMPLETED the flow — Safari for a PWA, the system sheet for the native
     shell — not in the app. So the resolved member is parked for the app to
     collect.

     A parked-state callback gets NO cookie of its own: it is non-authenticating
     (see `viaParkedState`), so the landing says "go back to the app" instead of
     "you're in". The native sheet still passed its own state cookie, so it is
     signed in as before, and it carries the return code home in the fragment —
     never the query, which reaches our logs. */
  if (handoff) {
    const completed = await completeHandoff(handoff, member.id);
    if (completed) {
      /* ONE message per path. A native landing's card already says "back to
         the app", so it never gets `handedOff` (whose copy points at the Home
         Screen), and a parked native sheet holds no session, so it does not
         get `signedIn` either. */
      const params: Record<string, string> = { provider: claims.provider, ...nativeParam };
      if (!claims.viaParkedState) params.signedIn = '1';
      else if (!stash?.native) params.handedOff = '1';
      const res = seeOther(
        landing(origin, params, completed.returnCode ? `hc=${completed.returnCode}` : undefined),
      );
      clearOAuthCookies(res);
      if (!claims.viaParkedState) await completeSignIn(res, member, resolveGroupId(req));
      return res;
    }
    // Parking failed (expired or swept). A native sheet passed its own cookie,
    // so signing that sheet in is still honest. A parked-state callback may not.
  }

  if (claims.viaParkedState) return oauthFailure(origin, 'state_mismatch');

  const res = seeOther(landing(origin, { signedIn: '1', provider: claims.provider }));
  // ORDER: every `cookies.set` must happen BEFORE completeSignIn. Its
  // clearAdminCookie branch APPENDS raw Set-Cookie headers, and a later
  // `.set()` re-serializes the whole cookie map and silently drops them --
  // leaving a stale admin_session alive for a non-admin. Verified, and
  // pinned by __tests__/auth-cookie-order.test.ts.
  clearOAuthCookies(res);
  await completeSignIn(res, member, resolveGroupId(req));
  return res;
}
