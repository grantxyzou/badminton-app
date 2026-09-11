'use client';

/**
 * Carrying "they were creating a group" across an OAuth excursion.
 *
 * THE PROBLEM. Signing in with Google navigates the page away, and
 * `lib/oauthCallback.ts`'s `landing()` builds the return URL FROM SCRATCH — it
 * never reads the inbound one. So no query parameter survives, and every piece
 * of onboarding state in `HomeShell` (`onboarding`, `joinToken`,
 * `doorsDismissed`) is plain `useState` that is gone by the time the person
 * comes back. Without this file they land on Home or the doors, having just
 * signed in for the express purpose of creating a club.
 *
 * WHAT IT CARRIES, AND WHAT IT DELIBERATELY DOES NOT. Only the intent. The
 * create flow asks for sign-in FIRST and the club-details form second, so
 * nothing has been typed when the hop happens and there is no draft to
 * preserve. That is not an accident of ordering — it is most of why that
 * ordering was chosen. The join flow additionally carries its invite token,
 * because `?join=` was stripped from the URL (it is a bearer credential) by the
 * param effect of a document that has since died, making this the only
 * surviving copy.
 *
 * ITS OWN KEY, NOT `badminton_excursion_at`. That marker is already spoken for:
 * `ProviderButtons` writes it on every tap and `HomeShell` consumes it
 * DESTRUCTIVELY for tab restore. Two destructive consumers of one key race, and
 * whichever reads first destroys it for the other.
 *
 * localStorage, not sessionStorage, for `lib/handoffClient.ts`'s recorded
 * reason: iOS may evict the PWA during the excursion, and a session store would
 * be gone at precisely the moment it is needed.
 *
 * THE RECORD ALONE NEVER NAVIGATES ANYBODY. It is half of an AND — the reader
 * acts only when this page load is also the far side of a sign-in. A cold start
 * carrying a stale marker and nothing else must route nobody; that is the
 * difference between a resume and a trap.
 */

const KEY = 'badminton_onboarding_resume';

/**
 * Ten minutes, mirroring `HANDOFF_TTL_MS`. NOT imported from `lib/authHandoff.ts`
 * — that module pulls in `crypto` and the Cosmos client and is server-only, the
 * same reason `lib/handoffClient.ts` mirrors the server's hex regex rather than
 * importing it. The value is right here for the reason it is right there: a
 * resume can never be more useful than the sign-in it rides on.
 */
const TTL_MS = 10 * 60 * 1000;

export type OnboardingIntent = 'create' | 'join';

export interface OnboardingResume {
  intent: OnboardingIntent;
  /** The invite token, for a JOIN resume only. See the header. */
  token?: string;
  at: number;
}

function isIntent(value: unknown): value is OnboardingIntent {
  return value === 'create' || value === 'join';
}

/** Parse defensively: anything unrecognised is treated as no record at all. */
function parse(raw: string | null): OnboardingResume | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<OnboardingResume>;
    if (!v || !isIntent(v.intent) || typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
    return {
      intent: v.intent,
      at: v.at,
      ...(typeof v.token === 'string' && v.token.length > 0 ? { token: v.token } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Record the intent. Call SYNCHRONOUSLY at the tap, ahead of the navigation —
 * the same rule `stageHandoff` and `markExternalExcursion` already follow,
 * because after the navigation there is no code of ours left to run.
 */
export function markOnboardingResume(intent: OnboardingIntent, token?: string): void {
  try {
    const record: OnboardingResume = { intent, at: Date.now(), ...(token ? { token } : {}) };
    window.localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* Private mode or storage disabled: no resume, which is today's behaviour. */
  }
}

/**
 * Read and REMOVE, returning the record only if it is still fresh.
 *
 * Destructive regardless of freshness, mirroring `consumeRecentExcursion`'s
 * rule that a marker must not leak into a later, unrelated visit. Call this
 * only when the caller has already established that this page load is a
 * sign-in landing — see the header.
 */
export function consumeOnboardingResume(): OnboardingResume | null {
  try {
    const record = parse(window.localStorage.getItem(KEY));
    window.localStorage.removeItem(KEY);
    if (!record) return null;
    return Date.now() - record.at < TTL_MS ? record : null;
  } catch {
    return null;
  }
}

/**
 * Drop a record that has expired, and ONLY one that has expired.
 *
 * Deliberately separate from `consume` so that a page load which is not a
 * sign-in landing can bound the record's lifetime without eating it. An
 * unconditional destructive read at mount would mean a second tab reloading
 * mid-excursion destroys the record the first tab is about to come back for.
 */
export function pruneStaleOnboardingResume(): void {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return;
    const record = parse(raw);
    // Unparseable is also stale: nothing will ever read it successfully.
    if (!record || Date.now() - record.at >= TTL_MS) window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Forget the intent outright — the person backed out of the flow, or finished
 * it without ever leaving the page. Unconditional: this is the explicit
 * statement that the record no longer describes anything.
 */
export function clearOnboardingResume(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
