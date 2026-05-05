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
