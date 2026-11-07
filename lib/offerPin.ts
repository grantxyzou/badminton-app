/**
 * One-shot sessionStorage marker: "an approval just signed this person in —
 * offer them a way back in". `SignedOutShell` writes it before the reload that
 * the sign-in triggers; `HomeTab` consumes it and opens "Keep your account"
 * (Apple, Google, or an email and password — no PIN since 2026-11-07,
 * docs/plans/door-link.md), because a member let in by an approval has a
 * 30-day session and nothing to sign in with after it.
 *
 * The key keeps its old name (`offer_pin`) so a phone mid-approval across the
 * deploy still gets the offer.
 *
 * Its own file so the signed-out screen does not import all of Home for a
 * string.
 */
export const OFFER_PIN_KEY = 'badminton_offer_pin';

/**
 * The email a door ask typed (Grant, 2026-11-07), carried across the same
 * reload so "Keep your account" can fill it in. Consumed with the marker
 * above; it lives in this phone's own session storage, never on the server
 * until the person saves a password with it.
 */
export const KEEP_ACCOUNT_EMAIL_KEY = 'badminton_keep_account_email';
