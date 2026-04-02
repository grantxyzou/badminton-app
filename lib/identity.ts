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
  token: string;
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

export function setIdentity(id: Identity): void {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
}

export function clearIdentity(): void {
  localStorage.removeItem(IDENTITY_KEY);
}
