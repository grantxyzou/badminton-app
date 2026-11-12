/**
 * Is this plausibly an email address? PURE — no Cosmos, no React — so a
 * client component can ask the same question a route does (the stringing job
 * page asks it of a walk-up's contact; `lib/stringing.ts` `walkUpEmailOf`).
 * Moved out of `lib/authIdentity.ts` (which imports `@/lib/cosmos`) on
 * 2026-11-12; that module re-exports both names, so its callers are unchanged.
 */

/**
 * RFC 5321's maximum path length. Also the ReDoS guard: an unbounded string is
 * what turns a merely-quadratic matcher into a denial of service.
 */
export const MAX_EMAIL_LENGTH = 254;

/**
 * Is this plausibly an email address?
 *
 * DELIBERATELY NOT A REGEX. The obvious pattern —
 * `^[^\s@]+@[^\s@]+\.[^\s@]+$` — is polynomial-time on hostile input,
 * because `[^\s@]` matches `.` too: the two quantified groups and the literal
 * dot all compete for the same characters, so a non-matching string makes the
 * engine try every split point. CodeQL flagged exactly this, and it was
 * reachable from an unauthenticated POST body with no length cap.
 *
 * String scanning has no backtracking to exploit. It is also permissive on
 * purpose: strict RFC 5322 validation rejects real addresses, and the
 * verification email is the actual proof that an address works. This only
 * catches obvious typos before we spend a Cosmos write on them.
 */
export function isPlausibleEmail(value: string): boolean {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) return false;
  if (/\s/.test(value)) return false; // single class, no quantifier — linear

  const at = value.indexOf('@');
  if (at <= 0) return false;
  if (at !== value.lastIndexOf('@')) return false; // exactly one @

  const domain = value.slice(at + 1);
  if (domain.length === 0) return false;

  const dot = domain.lastIndexOf('.');
  // A dot, not leading, and not trailing.
  return dot > 0 && dot < domain.length - 1;
}
