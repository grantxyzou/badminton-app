/**
 * The public shape of a Member and of a Player: the document with every
 * credential and every secret removed. These are the strip sites the
 * security rules talk about (`deleteToken` never in a response, `pinHash`
 * is a strip-canary, and the member-record family `recoveryCode`,
 * `passwordHash`, `emailVerification`, `passwordReset`), collected from the
 * thirteen hand-written destructures that used to sit in three route files.
 *
 * `__tests__/auth-strip-canary.test.ts` scans for the recoveryCode rename
 * marker and checks that every block dropping it drops the others too — so
 * the destructure below is written out in full, in that exact form, rather
 * than as a loop over a field list: the canary is structural, and a helper
 * it cannot read is a helper it cannot guard.
 *
 * `email` comes off here as well. It is a NARROW canary — the one route
 * that may echo it is `members/me`, where the caller reads their own record,
 * and that route projects its fields in SQL and never calls this.
 */

/** A member record with every secret removed, `email` included. */
export function publicMember<T extends Record<string, unknown>>(doc: T | undefined | null) {
  const {
    pinHash: _ph,
    recoveryCode: _rc,
    passwordHash: _pw,
    emailVerification: _ev,
    passwordReset: _pr,
    email: _em,
    ...safe
  } = (doc ?? {}) as Record<string, unknown>;
  return safe;
}

/**
 * A player row with its credentials removed. `deleteToken` is returned ONCE,
 * by the sign-up that minted it; a caller on that path adds it back
 * explicitly, so the omission here is never silent.
 */
export function publicPlayer<T extends Record<string, unknown>>(doc: T) {
  const { deleteToken: _dt, pinHash: _ph, ...safe } = doc as Record<string, unknown>;
  return safe as Omit<T, 'deleteToken' | 'pinHash'>;
}
