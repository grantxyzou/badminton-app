/**
 * "What this person owes has just changed — anyone showing it should re-read."
 *
 * The balance card and the stringing card are separate components that fetch
 * separately, so an action inside one leaves the other stale. That is usually
 * harmless; here it is not. Accepting a price change moved the bill from $30 to
 * $34 and left the balance line above it still reading $30 — the app
 * contradicting itself about the same racket on the same screen, which is
 * exactly the failure `toPlayerJob`'s `amountDue` comment describes and the
 * reason that field exists at all.
 *
 * Modelled on `IDENTITY_EVENT` in lib/identity.ts, and for the same reason: the
 * browser's own `storage` event fires only in OTHER tabs, so same-tab
 * reactivity needs a CustomEvent. Deliberately a bare signal with no payload —
 * a subscriber's job is to re-read the endpoint it already trusts, not to
 * believe a number it was handed by another component.
 */
export const BALANCE_EVENT = 'badminton:balance-changed';

export function announceBalanceChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BALANCE_EVENT));
}
