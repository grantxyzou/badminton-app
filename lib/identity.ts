/**
 * Consolidated localStorage identity for the current player.
 * Replaces separate `badminton_username` / `badminton_deletetoken` keys
 * with a single `badminton_identity` key that also tracks sessionId.
 */

const IDENTITY_KEY = 'badminton_identity';

// Legacy keys — used only for one-time migration
const LEGACY_NAME_KEY = 'badminton_username';
const LEGACY_TOKEN_KEY = 'badminton_deletetoken';

export interface Identity {
  name: string;
  /** Session-player deleteToken. Absent for account-only identities created
   *  via the `sessionSignup: false` POST path — those upgrade to a full
   *  identity once the user signs up for a session. */
  token?: string;
  sessionId: string;
}

/**
 * Read the current identity from localStorage.
 * On first call, migrates legacy keys if present.
 */
export function getIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.name === 'string') return parsed as Identity;
    }

    // One-time migration from legacy keys
    const legacyName = localStorage.getItem(LEGACY_NAME_KEY);
    if (legacyName) {
      const migrated: Identity = {
        name: legacyName,
        token: localStorage.getItem(LEGACY_TOKEN_KEY) ?? '',
        sessionId: '', // unknown — will be validated against player list
      };
      localStorage.setItem(IDENTITY_KEY, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_NAME_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      return migrated;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Custom event dispatched on identity mutation. Lets page-level subscribers
 * (e.g. the admin-nav-slot check in app/page.tsx) react to sign-in / sign-out
 * within the same tab — `storage` events only fire in OTHER tabs, so a custom
 * event is needed for intra-tab updates.
 */
export const IDENTITY_EVENT = 'badminton:identity-changed';

function dispatchIdentityChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(IDENTITY_EVENT));
}

export function setIdentity(id: Identity): void {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
  dispatchIdentityChange();
}

export function clearIdentity(): void {
  localStorage.removeItem(IDENTITY_KEY);
  dispatchIdentityChange();
}

/** Decision returned by `resolveStaleIdentity`. */
export type StaleIdentityAction =
  /** No change — stored identity already matches the active session, or no identity stored. */
  | { action: 'keep' }
  /** PIN-protected member crossing a session boundary. Preserve name, refresh
   *  sessionId, drop the deleteToken (which was bound to the old session). */
  | { action: 'preserve'; identity: Identity }
  /** Anonymous user crossing a session boundary. Both deleteToken and identity
   *  are stale because they're session-bound. Clear all. */
  | { action: 'clear' };

/**
 * Decide what to do with a stored identity when the active session has
 * advanced. Pure function so the logic can be unit-tested without mounting
 * HomeTab or stubbing localStorage. Caller is responsible for actually
 * applying the decision (set vs clear).
 *
 * Pre-2026-05-08 the rule was "always clear on session-id mismatch," which
 * was correct under the old single-tier auth model where identity = a
 * session-player record + deleteToken. With the auth taxonomy split, a
 * PIN-protected member is validly authenticated even between sessions —
 * clearing forced them to PIN-auth weekly. Closes #60.
 */
export function resolveStaleIdentity(
  stored: Identity | null,
  activeSessionId: string,
  /**
   * Does this identity outlive a session? TRUE for anyone holding a credential
   * that is not the session itself — a PIN, a password, a linked provider, or
   * simply a live `member_session` on this device.
   *
   * IT WAS `hasPin`, AND THAT WAS ONLY EVER HALF THE QUESTION. The rule was
   * written when a PIN was the only way to be more than an anonymous sign-up,
   * so an email or Google member looked exactly like a stranger and had their
   * identity cleared whenever the session id moved.
   *
   * MULTI-GROUP TURNED A WEEKLY ANNOYANCE INTO A BROKEN FLOW. A group's active
   * session id is its own (`<groupId>:session-YYYY-MM-DD`), so JOINING or
   * SWITCHING a club changes it every single time. Found by walking the join
   * flow: the server had Priya on the club's roster and the client had wiped
   * her identity by the time the page rendered, dropping her back on the
   * welcome doors having just successfully joined.
   */
  durable: boolean,
): StaleIdentityAction {
  if (!stored || !stored.sessionId) return { action: 'keep' };
  if (stored.sessionId === activeSessionId) return { action: 'keep' };
  if (durable) {
    return {
      action: 'preserve',
      identity: { name: stored.name, sessionId: activeSessionId },
    };
  }
  return { action: 'clear' };
}
