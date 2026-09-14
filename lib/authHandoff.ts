/**
 * Carrying a sign-in across a STORAGE-CONTEXT boundary.
 *
 * THE PROBLEM THIS EXISTS FOR — measured, not theorised
 * ----------------------------------------------------
 * An installed iOS PWA runs in its own WKWebView with its own cookie jar. A
 * top-level navigation to accounts.google.com leaves that webview, so the whole
 * OAuth excursion — consent, our callback, the landing — is performed by
 * SAFARI. The production log line from a real device (2026-08-27, iOS 18.7):
 *
 *   state=cookie_absent cookies=[NEXT_LOCALE] count=1
 *   sec-fetch-site=cross-site referer=https://accounts.google.com/
 *
 * Note `count=1`. Safari's jar DOES know this origin — it holds `NEXT_LOCALE`
 * from ordinary browsing — it simply never received `bpm_oauth_state`, because
 * `/start` ran inside the PWA. That single detail rules out every
 * cookie-attribute theory at once: SameSite, path, domain and manifest scope
 * all describe how ONE jar behaves, and the cookie is in a different one.
 *
 * Two consequences, and the second is the one that matters:
 *   1. The callback carries no state cookie AND no PKCE verifier cookie.
 *   2. `completeSignIn` sets `member_session` on the callback response — issued
 *      to SAFARI. So even a perfect state check leaves the member signed in
 *      *in Safari* and still signed out in the PWA. This is why the reported
 *      symptom is "still shows the safari shell".
 *
 * THE SHAPE OF THE FIX — PKCE, applied to ourselves
 * -------------------------------------------------
 * The PWA mints a secret `handoffId` into its OWN localStorage, which survives
 * the excursion because it never leaves the app. Only `handoffRef =
 * sha256(handoffId)` enters the flow, so the value travelling through Google,
 * the URL, referer headers and any log is a HASH, never a credential.
 *
 * Two phases against that ref:
 *   BEGIN    `/start` parks the CSRF state and the PKCE verifier server-side.
 *            This is what the absent cookies were carrying.
 *   COMPLETE the callback — wherever it lands — validates state against the
 *            parked copy, exchanges the code, and parks the resolved memberId.
 *   CLAIM    the PWA presents the PREIMAGE, same-origin, and gets a session
 *            cookie minted in its own jar.
 *
 * WHAT KEEPS THIS FROM BEING A LOGIN-CSRF / TAKEOVER BRIDGE
 * ---------------------------------------------------------
 * The first version argued that the preimage contained the attack: completing a
 * flow is not the win, redeeming it is, and only the PWA holds the preimage.
 * The 2026-09-11 security scan (F3, F4, F13) showed that argument was false.
 * THE PREIMAGE PROVES WHO STARTED A SIGN-IN, NEVER WHO FINISHED IT. The ref is
 * chosen by whoever calls `/start`, so an attacker can mint a pair, hand the
 * victim a link, let the victim finish, and redeem the victim's session.
 *
 * What the code now guarantees, and where:
 *   1. A stash is COMPLETED only when the callback actually needed it — the
 *      state cookie was absent and the parked state stood in for it — or the
 *      stash says the native shell started the flow. A single-jar browser that
 *      merely carries `?hr=` (every web flow does) parks nothing, so a crafted
 *      link opened in an ordinary browser yields nothing claimable (F4).
 *   2. A callback validated through the PARKED state is NON-AUTHENTICATING.
 *      Nothing about that browser proves it started the flow, so it gets no
 *      `member_session`, and its own session is never read as "link this
 *      provider to me" (F3, and F13 — the Apple callback shares the helper).
 *   3. A NATIVE stash needs a RETURN CODE to claim. The code is minted at
 *      completion and handed only to the browser that completed it — in the
 *      landing URL's fragment, which the landing forwards through
 *      `bpm://auth/return?c=`. Whoever holds the preimage still cannot claim
 *      without it, so a `&native=1` link sent to a victim is dead too.
 *
 * WHAT IS STILL OPEN, deliberately (Grant, 2026-09-14): the installed iOS PWA
 * path in (1). Its completing browser is Safari and iOS gives Safari no way
 * back into a home-screen app, so there is no channel for a return code short
 * of the person typing one. An attacker who runs `/start?hr=` themselves and
 * sends a victim the PROVIDER's authorization URL still gets the victim's
 * memberId parked under the attacker's ref. Closing it is a product decision:
 * a typed code on that path, or no Google/Apple inside the installed PWA.
 *
 * The cookie path is UNCHANGED and still preferred — see the callback.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';

const CONTAINER = 'authhandoff';
/** Long enough to finish a consent screen and walk back to the app; short
 *  enough that an unclaimed stash is not a standing credential. */
export const HANDOFF_TTL_MS = 10 * 60 * 1000;

let ready: Promise<void> | null = null;
function containerReady(): Promise<void> {
  if (!ready) {
    ready = ensureContainer(CONTAINER, '/id').catch((err) => {
      ready = null; // let the next request retry rather than cache a failure
      throw err;
    });
  }
  return ready;
}

/** The secret. Lives only in the PWA's localStorage and in the claim body. */
export function createHandoffId(): string {
  return randomBytes(32).toString('hex');
}

/**
 * The public half. Goes into the OAuth state, so it must be one-way: anyone who
 * sees it must not be able to claim with it.
 */
export function handoffRef(handoffId: string): string {
  return createHash('sha256').update(handoffId, 'utf8').digest('hex');
}

/** A ref is a hex sha256. Reject anything else before it reaches the store. */
export function isHandoffRef(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export interface HandoffDoc {
  /** The REF (hash), never the id — the store must not hold a usable credential. */
  id: string;
  /** What the absent `bpm_oauth_state` cookie would have carried. */
  state: string;
  /** What the absent `bpm_oauth_verifier` cookie would have carried. Apple
   *  has no PKCE verifier, so its stash carries an empty string here. */
  codeVerifier: string;
  /**
   * The flow began in the NATIVE shell (`/start?native=1`). The excursion runs
   * in the system browser sheet, and nothing on iOS hands back to the app when
   * it lands — so the landing page has to render a "back to the app" link.
   * This is how the callback learns to add `?native=1` to that landing.
   * Additive: absent means a PWA or browser flow.
   */
  native?: boolean;
  /**
   * WHICH CLUB THE SIGN-IN BELONGS TO, parked because nothing else can carry it.
   *
   * The whole reason this stash exists is that the excursion runs in a
   * DIFFERENT COOKIE JAR — the system browser sheet, not the PWA — so the
   * callback and the claim see no `member_session` and `resolveGroupId` answers
   * BPM for everybody. A member of another club signing in with Google would
   * land in BPM, holding a cookie claiming a group they are not on the roster
   * of. The stash is the one thing that crosses the split, so the group rides
   * in it. Additive: absent means BPM, which is what every pre-claim stash is.
   */
  groupId?: string;
  /** Set by `completeHandoff` once the provider handshake resolves a member. */
  memberId?: string;
  /**
   * sha256 of the RETURN CODE a native completion minted. Present means the
   * claim must present the code as well as the preimage — see guarantee 3 in
   * the docblock. The code itself is never stored. Additive: absent means no
   * code is required, which is every PWA stash.
   */
  returnCodeHash?: string;
  createdAt: string;
  expiresAt: string;
}

function live(doc: HandoffDoc | null, now: number): doc is HandoffDoc {
  return !!doc && Date.parse(doc.expiresAt) > now;
}

async function readDoc(ref: string): Promise<HandoffDoc | null> {
  try {
    const { resource } = await getContainer(CONTAINER).item(ref, ref).read<HandoffDoc>();
    return resource ?? null;
  } catch {
    return null;
  }
}

/**
 * Park the state and PKCE verifier for a flow that may come back in a different
 * storage context.
 *
 * FIRST WRITE WINS while a stash is live — that is what closes the race half of
 * the login-CSRF path in the docblock. An EXPIRED stash may be replaced, or one
 * abandoned attempt would burn that ref until a sweep caught it.
 */
export async function beginHandoff(
  ref: string,
  values: { state: string; codeVerifier: string; native?: boolean; groupId?: string },
  now: number = Date.now(),
): Promise<boolean> {
  if (!isHandoffRef(ref)) return false;
  await containerReady();

  const existing = await readDoc(ref);
  if (live(existing, now)) return false;

  const doc: HandoffDoc = {
    id: ref,
    state: values.state,
    codeVerifier: values.codeVerifier,
    ...(values.native ? { native: true } : {}),
    ...(values.groupId ? { groupId: values.groupId } : {}),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + HANDOFF_TTL_MS).toISOString(),
  };
  await getContainer(CONTAINER).items.upsert(doc);
  return true;
}

/**
 * The callback's replacement for reading its two cookies. Returns null for
 * absent or expired alike.
 */
export async function readHandoff(
  ref: string,
  now: number = Date.now(),
): Promise<HandoffDoc | null> {
  if (!isHandoffRef(ref)) return null;
  await containerReady();
  const doc = await readDoc(ref);
  return live(doc, now) ? doc : null;
}

/** Constant-time state comparison against the parked copy. */
export function handoffStateMatches(parked: string, callbackState: string | null): boolean {
  if (!callbackState) return false;
  const a = Buffer.from(parked, 'utf8');
  const b = Buffer.from(callbackState, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** What a completion hands back to the browser that performed it. */
export interface CompletedHandoff {
  /**
   * The code the claim must present, for a stash the NATIVE shell started;
   * `null` for every other stash. It goes to the completing browser only —
   * never into a log, a query string or the store.
   */
  returnCode: string | null;
}

function hashReturnCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/**
 * Attach the resolved member so the app can collect it. `null` when the stash
 * is absent or expired.
 */
export async function completeHandoff(
  ref: string,
  memberId: string,
  now: number = Date.now(),
): Promise<CompletedHandoff | null> {
  if (!isHandoffRef(ref)) return null;
  await containerReady();
  const doc = await readDoc(ref);
  if (!live(doc, now)) return null;
  const returnCode = doc.native ? randomBytes(32).toString('hex') : null;
  await getContainer(CONTAINER).items.upsert({
    ...doc,
    memberId,
    ...(returnCode ? { returnCodeHash: hashReturnCode(returnCode) } : {}),
  });
  return { returnCode };
}

/**
 * Redeem a completed stash. SINGLE USE: the document is deleted before the
 * memberId is returned, so a replay finds nothing.
 *
 * Returns null for absent, expired, already-claimed AND not-yet-complete
 * alike — deliberately indistinguishable, so a probe cannot learn whether a ref
 * was ever real. The one exception is `pending`, which the route needs in order
 * to keep polling rather than give up; it is reported as a status, not as data.
 */
export type HandoffClaim =
  | { status: 'ready'; memberId: string; groupId?: string }
  | { status: 'pending' }
  | { status: 'none' };

export async function claimHandoff(
  handoffId: string,
  now: number = Date.now(),
  returnCode: string | null = null,
): Promise<HandoffClaim> {
  const ref = handoffRef(handoffId);
  await containerReady();

  const doc = await readDoc(ref);
  if (!live(doc, now)) return { status: 'none' };
  // The excursion has not finished yet. Leave the stash alone so the next poll
  // can find it — deleting here would strand a sign-in that was still in
  // flight, which on a slow phone is the common case, not the rare one.
  if (!doc.memberId) return { status: 'pending' };

  /* A native stash wants its return code. ABSENT is `pending`, not a failure:
     the app polls on every foreground, and on a real phone that poll routinely
     beats the `bpm://auth/return` that carries the code — burning the stash
     then would strand the very sign-in the code was on its way to finish.
     WRONG is terminal: only a preimage holder can send one, and a legitimate
     app never has a code for a different stash. */
  if (doc.returnCodeHash) {
    if (!returnCode) return { status: 'pending' };
    const a = Buffer.from(doc.returnCodeHash, 'utf8');
    const b = Buffer.from(hashReturnCode(returnCode), 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      try {
        await getContainer(CONTAINER).item(ref, ref).delete();
      } catch {
        /* expires on its own */
      }
      return { status: 'none' };
    }
  }

  // Delete FIRST. If the delete fails we must not hand out the session, or a
  // replay could redeem the same stash twice.
  try {
    await getContainer(CONTAINER).item(ref, ref).delete();
  } catch {
    return { status: 'none' };
  }
  return { status: 'ready', memberId: doc.memberId, ...(doc.groupId ? { groupId: doc.groupId } : {}) };
}
