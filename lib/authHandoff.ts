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
 *      stash says the native shell or a pop-up started the flow, whose windows
 *      are not the app's even when they hold the cookie. A single-jar browser that
 *      merely carries `?hr=` (every web flow does) parks nothing, so a crafted
 *      link opened in an ordinary browser yields nothing claimable (F4).
 *   2. A callback validated through the PARKED state is NON-AUTHENTICATING.
 *      Nothing about that browser proves it started the flow, so it gets no
 *      `member_session`, and its own session is never read as "link this
 *      provider to me" (F3, and F13 — the Apple callback shares the helper).
 *   3. EVERY COMPLETED STASH NEEDS A CODE TO CLAIM. The code is minted at
 *      completion and handed only to the browser that completed it, so the
 *      preimage alone — which the attacker has, because they chose it — claims
 *      nothing. Two kinds, by the channel home:
 *        - a RETURN CODE (256 bits) where a machine carries it: the native
 *          shell's `bpm://auth/return?c=`, and a POP-UP's `postMessage` to the
 *          app that opened it (`/start?popup=1`, the installed iOS web app);
 *        - a TYPED CODE (6 digits) where only a person can: the full-page
 *          Safari trip, and a pop-up that could not report back. Short enough
 *          to type, so it is capped at TYPED_CODE_MAX_ATTEMPTS and every
 *          attempt is counted under an etag BEFORE it is compared — a flood of
 *          parallel guesses cannot all read the same count. A fresh stash
 *          means a fresh victim completion, so guessing does not scale.
 *      The native shell never gets a typed code: it always has its channel.
 *   4. A NEW provider identity on a hand-off is never named in the browser
 *      that completed it. Its verified facts are parked HERE (`pending`), and
 *      the claim — preimage plus code — sets the pending-signup cookie in the
 *      APP's jar, where the name step (and `claim-name`'s PIN) then runs.
 *      Before this, a victim who opened an attacker's captured callback could
 *      type their own name and PIN into it and link the attacker's Google
 *      account to themselves. The native shell's own cookie-bound name step
 *      (its sheet ran `/start`) is unchanged.
 *
 * The remaining exposure is a person reading a code off their own screen to
 * someone who asks for it — the device-code phishing every such flow has. The
 * page that shows it says not to.
 *
 * The cookie path is UNCHANGED and still preferred — see the callback.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';

/** Wrong typed codes a stash survives before it is burned. See guarantee 3. */
export const TYPED_CODE_MAX_ATTEMPTS = 5;

/**
 * A provider identity with no member yet, parked for the app to name
 * (guarantee 4). The same verified facts `lib/pendingSignup.ts` carries.
 */
export interface PendingProviderIdentity {
  provider: 'google' | 'apple';
  sub: string;
  email: string | null;
  emailVerified: boolean;
  suggestedName: string | null;
}

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
  /**
   * The flow runs in a POP-UP the installed iOS web app opened
   * (`/start?popup=1`). Its completion reports home by `postMessage`, so it
   * gets a return code as well as a typed one. Additive: absent means not.
   */
  popup?: boolean;
  /**
   * Where the pop-up posts its return code: the ORIGIN of the app that opened
   * it, checked against our own origins at `/start`. The app can run on more
   * than one (the Azure host as well as APP_ORIGIN), and a `postMessage`
   * aimed at the wrong one is silently dropped.
   */
  openerOrigin?: string;
  /** Set by `completeHandoff` once the provider handshake resolves a member. */
  memberId?: string;
  /** Set instead of `memberId` when the identity has no member yet (guarantee 4). */
  pending?: PendingProviderIdentity;
  /**
   * sha256 of the RETURN CODE a native or pop-up completion minted. The code
   * itself is never stored. See guarantee 3.
   */
  returnCodeHash?: string;
  /** sha256 of the ref and the TYPED CODE a web completion minted. */
  typedCodeHash?: string;
  /** Typed codes tried so far. Counted before comparing, under an etag. */
  typedAttempts?: number;
  /** Cosmos's concurrency token, present on every read. */
  _etag?: string;
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
  values: {
    state: string;
    codeVerifier: string;
    native?: boolean;
    popup?: boolean;
    openerOrigin?: string | null;
    groupId?: string;
  },
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
    // The native shell has its own channel home; a pop-up flag on it means nothing.
    ...(values.popup && !values.native ? { popup: true } : {}),
    ...(values.popup && !values.native && values.openerOrigin ? { openerOrigin: values.openerOrigin } : {}),
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
   * 64 hex, for a stash with a machine channel home — the native shell or a
   * pop-up; `null` otherwise. Goes to the completing browser only, in a URL
   * FRAGMENT — never a log, a query string or the store.
   */
  returnCode: string | null;
  /** 6 digits for the person to type, for every web completion; `null` for native. */
  typedCode: string | null;
  /** The pop-up's opener origin, when it posts its return code home. */
  openerOrigin: string | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Salted with the ref: six digits alone hash to a table anyone can build. */
function hashTypedCode(ref: string, code: string): string {
  return sha256(`${ref}:${code}`);
}

function sameHash(stored: string, candidate: string): boolean {
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(candidate, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Attach the outcome so the app can collect it: the resolved member's id, or a
 * provider identity still to be named (`{ pending }`, guarantee 4). `null`
 * when the stash is absent or expired.
 *
 * Every completion mints the code(s) the claim will require (guarantee 3), and
 * restarts the TTL — the person still has to walk back to the app and may
 * have to type a code there.
 */
export async function completeHandoff(
  ref: string,
  outcome: string | { pending: PendingProviderIdentity },
  now: number = Date.now(),
): Promise<CompletedHandoff | null> {
  if (!isHandoffRef(ref)) return null;
  await containerReady();
  const doc = await readDoc(ref);
  if (!live(doc, now)) return null;

  const returnCode = doc.native || doc.popup ? randomBytes(32).toString('hex') : null;
  const typedCode = doc.native ? null : String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { _etag: _e, memberId: _m, pending: _p, ...rest } = doc;
  const next: HandoffDoc = {
    ...rest,
    ...(typeof outcome === 'string' ? { memberId: outcome } : { pending: outcome.pending }),
    ...(returnCode ? { returnCodeHash: sha256(returnCode) } : {}),
    ...(typedCode ? { typedCodeHash: hashTypedCode(ref, typedCode), typedAttempts: 0 } : {}),
    expiresAt: new Date(now + HANDOFF_TTL_MS).toISOString(),
  };
  await getContainer(CONTAINER).items.upsert(next);
  return { returnCode, typedCode, openerOrigin: doc.popup ? (doc.openerOrigin ?? null) : null };
}

/**
 * Redeem a completed stash. SINGLE USE: the document is deleted before the
 * outcome is returned, so a replay finds nothing.
 *
 * Absent, expired, already-claimed and burned are ONE answer, `none`, so a
 * probe cannot learn whether a ref was ever real. The rest are statuses the
 * app needs in order to act, and only a preimage holder ever sees them:
 *   `pending`        the excursion has not finished, or a native return code
 *                    is still on its way home — keep polling;
 *   `code_required`  finished, and waiting for the person to type the code —
 *                    `wrong` when the last one did not match;
 *   `needs_name`     a new provider identity, now parked in the app's jar;
 *   `ready`          a member.
 */
export type HandoffClaim =
  | { status: 'ready'; memberId: string; groupId?: string }
  | { status: 'needs_name'; pending: PendingProviderIdentity; groupId?: string }
  | { status: 'pending' }
  | { status: 'code_required'; wrong: boolean }
  | { status: 'none' };

export interface HandoffCodes {
  returnCode?: string | null;
  typedCode?: string | null;
}

async function burn(ref: string): Promise<void> {
  try {
    await getContainer(CONTAINER).item(ref, ref).delete();
  } catch {
    /* expires on its own */
  }
}

export async function claimHandoff(
  handoffId: string,
  now: number = Date.now(),
  codes: HandoffCodes = {},
): Promise<HandoffClaim> {
  const ref = handoffRef(handoffId);
  await containerReady();

  const doc = await readDoc(ref);
  if (!live(doc, now)) return { status: 'none' };
  // The excursion has not finished yet. Leave the stash alone so the next poll
  // can find it — deleting here would strand a sign-in that was still in
  // flight, which on a slow phone is the common case, not the rare one.
  if (!doc.memberId && !doc.pending) return { status: 'pending' };

  const returnCode = codes.returnCode ?? null;
  const typedCode = codes.typedCode ?? null;

  if (returnCode && doc.returnCodeHash) {
    /* WRONG is terminal: only a preimage holder can send one, and a legitimate
       app never has a code for a different stash. */
    if (!sameHash(doc.returnCodeHash, sha256(returnCode))) {
      await burn(ref);
      return { status: 'none' };
    }
  } else if (typedCode && doc.typedCodeHash) {
    /* COUNT, THEN COMPARE. The increment is conditioned on the etag this read
       returned, so of any number of parallel guesses exactly one per version
       gets to compare; the rest are told to try again and compared nothing. */
    const attempts = (doc.typedAttempts ?? 0) + 1;
    if (attempts > TYPED_CODE_MAX_ATTEMPTS) {
      await burn(ref);
      return { status: 'none' };
    }
    const { _etag, ...rest } = doc;
    try {
      await getContainer(CONTAINER).items.upsert(
        { ...rest, typedAttempts: attempts },
        _etag ? { accessCondition: { type: 'IfMatch', condition: _etag } } : undefined,
      );
    } catch {
      return { status: 'code_required', wrong: false };
    }
    if (!sameHash(doc.typedCodeHash, hashTypedCode(ref, typedCode))) {
      if (attempts >= TYPED_CODE_MAX_ATTEMPTS) {
        await burn(ref);
        return { status: 'none' };
      }
      return { status: 'code_required', wrong: true };
    }
  } else if (doc.returnCodeHash || doc.typedCodeHash) {
    /* No usable code yet. A stash a person can finish asks for one. A native
       stash stays `pending`: the app polls on every foreground, and on a real
       phone that poll routinely beats the `bpm://auth/return` carrying its
       code — burning or prompting then would strand the sign-in. */
    return doc.typedCodeHash ? { status: 'code_required', wrong: false } : { status: 'pending' };
  }

  // Delete FIRST. If the delete fails we must not hand out the session, or a
  // replay could redeem the same stash twice.
  try {
    await getContainer(CONTAINER).item(ref, ref).delete();
  } catch {
    return { status: 'none' };
  }
  const group = doc.groupId ? { groupId: doc.groupId } : {};
  if (doc.pending) return { status: 'needs_name', pending: doc.pending, ...group };
  return { status: 'ready', memberId: doc.memberId!, ...group };
}
