/**
 * One-shot sessionStorage marker: "an admin approval just signed this person
 * in — offer them a PIN". `SignedOutShell` writes it before the reload that the
 * sign-in triggers; `HomeTab` consumes it and opens the PIN sheet, because a
 * member let in by an access request has a 30-day session and nothing to sign
 * in with after it (docs/plans/members-only.md, 2026-09-13 flow audit).
 *
 * Its own file so the signed-out screen does not import all of Home for a
 * string.
 */
export const OFFER_PIN_KEY = 'badminton_offer_pin';
