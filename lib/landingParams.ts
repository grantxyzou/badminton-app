/**
 * URL parameters that make a visit a LANDING rather than a launch: the page
 * arrives with something to say (a sign-in error, a verified email, the name
 * step of a new Google account) or somewhere to go (an invite, a reset link,
 * the native return). `HomeShell` and `SignedOutShell` each consume these in
 * their URL effect; the launch screen reads the same list so it can get out of
 * the way — a shot played over a timed toast hides most of its life.
 *
 * `__tests__/landing-params-canary.test.ts` classifies every parameter either
 * shell reads as a landing or not, so one added there cannot be missed here.
 */
export const LANDING_PARAMS = ['authError', 'verified', 'signedIn', 'authFlow', 'reset', 'join', 'native'] as const;

/**
 * Read by a shell, and NOT a landing: a deep link into a tab is still a launch,
 * and the rest only ever ride along with a parameter above.
 */
export const NOT_LANDING_PARAMS = ['tab', 'intent', 'email', 'provider'] as const;

export function isLandingUrl(search: string): boolean {
  const params = new URLSearchParams(search);
  return LANDING_PARAMS.some((k) => params.has(k));
}
