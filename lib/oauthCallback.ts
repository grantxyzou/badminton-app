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
import { completeHandoff, readHandoff, type CompletedHandoff, type HandoffDoc } from '@/lib/authHandoff';
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

/**
 * Where a completed hand-off sends the browser that completed it.
 *
 * NATIVE keeps the app landing it has always had: `?native=1`, whose card and
 * auto-return carry the return code home through `bpm://auth/return`.
 *
 * Everything else — a pop-up, or the full-page Safari trip — goes to
 * `/bpm/auth/done`, a page that exists only to get the code back to the app:
 * it posts the return code to the pop-up's opener, and shows the typed code
 * when there is no opener to hear it. Inside the manifest scope, like
 * `landing()`.
 *
 * The codes ride in the FRAGMENT, which never reaches a server log.
 */
function handoffLanding(
  origin: string,
  provider: string,
  stash: HandoffDoc,
  completed: CompletedHandoff,
  signedIn: boolean,
): NextResponse {
  if (stash.native) {
    const params: Record<string, string> = { provider, native: '1' };
    if (signedIn) params.signedIn = '1';
    return seeOther(landing(origin, params, completed.returnCode ? `hc=${completed.returnCode}` : undefined));
  }
  const fragment = new URLSearchParams();
  if (completed.returnCode && completed.openerOrigin) {
    fragment.set('hc', completed.returnCode);
    fragment.set('ho', completed.openerOrigin);
  }
  if (completed.typedCode) fragment.set('tc', completed.typedCode);
  return seeOther(`${origin}/bpm/auth/done?${new URLSearchParams({ provider })}#${fragment}`);
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
  const handoff = stash && (claims.viaParkedState || stash.native || stash.popup) ? claims.handoff! : null;
  /* THE APP FINISHES THIS SIGN-IN, not the browser that completed it: a
     parked-state callback (nothing ties this browser to the flow) or a pop-up
     (a window the app opened, whose jar may not be the app's). Such a browser
     is never signed in and never names a new account — guarantee 4 in
     lib/authHandoff.ts. The native sheet ran `/start` itself and holds the
     state cookie, so its own sign-in and name step are unchanged. */
  const inApp = !!handoff && (claims.viaParkedState || !!stash?.popup);

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
    // Never when the app finishes: this browser's session is not a request to
    // link anything to it (F3), and a pop-up's may be some other person's.
    sessionMemberId: inApp ? null : (verifyMemberAuth(req)?.memberId ?? null),
    providerEmail: email,
    providerEmailVerified: claims.emailVerified,
    memberIdByVerifiedEmail,
  });

  if (action.kind === 'new-account') {
    const facts = {
      provider: claims.provider,
      sub: claims.sub,
      email,
      emailVerified: claims.emailVerified,
      suggestedName: claims.suggestedName,
    };
    /* Named IN THE APP: the facts are parked on the stash, and the claim puts
       them in the app's own pending-signup cookie. A cookie set here would let
       whoever opened this callback pick the name — or type a PIN that links
       this provider identity to their own account (Gap 1). */
    if (inApp) {
      const completed = await completeHandoff(handoff!, { pending: facts });
      if (!completed) return oauthFailure(origin, 'state_mismatch');
      const res = handoffLanding(origin, claims.provider, stash!, completed, false);
      clearOAuthCookies(res);
      return res;
    }
    // Needs a display name from the user, and must refuse names already taken —
    // so it cannot finish here. Park the verified facts in a SIGNED cookie and
    // let /api/auth/complete-signup finish once a name is chosen.
    const res = seeOther(landing(origin, { authFlow: 'name', ...nativeParam }));
    setPendingSignup(res, {
      ...facts,
      // Only the native sheet reaches here with a ref: its new account first
      // exists in complete-signup, which completes the stash and hands the
      // return code home.
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
     COMPLETED the flow — Safari, a pop-up, the system sheet — not in the app.
     So the resolved member is parked for the app to collect, behind the code
     `completeHandoff` mints (guarantee 3).

     When the app finishes (`inApp`) this browser gets no cookie of its own. The
     native sheet still passed its own state cookie, so it is signed in as
     before. */
  if (handoff) {
    const completed = await completeHandoff(handoff, member.id);
    if (completed) {
      const res = handoffLanding(origin, claims.provider, stash!, completed, !inApp);
      clearOAuthCookies(res);
      if (!inApp) await completeSignIn(res, member, resolveGroupId(req));
      return res;
    }
    // Parking failed (expired or swept). A native sheet passed its own cookie,
    // so signing that sheet in is still honest. Nothing else may.
  }

  if (inApp || claims.viaParkedState) return oauthFailure(origin, 'state_mismatch');

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
