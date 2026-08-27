/**
 * Password rules with NO crypto dependency, so a client component can mirror
 * them for instant feedback.
 *
 * Extracted from `lib/passwordHash.ts`, which imports `node:crypto` at module
 * scope and therefore cannot be pulled into a browser bundle. The behaviour is
 * unchanged and `passwordHash` re-exports `validatePasswordStrength`, so every
 * existing caller and test is untouched.
 *
 * The SERVER remains authoritative. This exists only so someone typing a
 * six-character password learns it is too short before a round trip, not so the
 * client can decide anything.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/** Passwords so common that length alone does not make them safe. */
const COMMON = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  '12345678901',
  'qwertyuiop',
  'letmein123',
  'iloveyou12',
  'admin12345',
  'welcome123',
  'badminton1',
  'shuttlecock',
]);

export function isCommonPassword(password: string): boolean {
  return COMMON.has(password.toLowerCase());
}

/**
 * Length plus a common-password blocklist. No composition rules — they push
 * people toward `Passw0rd!`, which is weaker than a long ordinary phrase.
 *
 * The `reason` is English prose intended for server logs and the API contract.
 * A client should NOT render it directly: it would appear untranslated in
 * zh-CN. Use the length/common helpers above and render localized copy.
 */
export function validatePasswordStrength(
  password: string,
): { ok: true } | { ok: false; reason: string } {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: 'That password is too long.' };
  }
  if (isCommonPassword(password)) {
    return { ok: false, reason: 'That password is too easy to guess.' };
  }
  return { ok: true };
}
