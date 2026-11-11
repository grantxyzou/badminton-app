import { MAX_EMAIL_LENGTH, isPlausibleEmail, normalizeEmail } from '@/lib/authIdentity';

/**
 * A member's contact email (`Member.contactEmail`, spec Q3): where their club
 * can reach them. Not a sign-in and never verified, so it is only ever checked
 * for shape, the same scan the sign-in forms use (no regex: see
 * `isPlausibleEmail`).
 *
 * `parseContactEmail` reads a PATCH body's value:
 * - a plausible address → that address, trimmed and lowercased;
 * - `null` or an empty string → `null`, which clears it;
 * - anything else → `undefined`, which the route answers with a 400.
 */
export function parseContactEmail(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_EMAIL_LENGTH || !isPlausibleEmail(trimmed)) return undefined;
  return normalizeEmail(trimmed);
}

/** A stored value read back: a string, or nothing. */
export function normalizeContactEmail(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}
