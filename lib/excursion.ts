/**
 * "External excursion" marker — bridges the tab-restore gap when the user
 * briefly leaves the PWA to a system surface (the native share sheet, a
 * full-screen receipt image, Quick Look) and comes back.
 *
 * Normally tab restore uses `sessionStorage` (see HomeShell): it survives an
 * in-app reload but is cleared on a quit/cold start, so a cold start lands on
 * Home. The problem: iOS often EVICTS the PWA while a share sheet / image
 * viewer is open, so returning is indistinguishable from a cold start —
 * sessionStorage is gone and the user is bounced to Home even though they only
 * stepped out to look at a receipt.
 *
 * Fix: call `markExternalExcursion()` synchronously right before handing off to
 * such a surface. It writes a timestamp to `localStorage` (which DOES survive a
 * cold relaunch). On mount, HomeShell calls `consumeRecentExcursion()`; if the
 * marker is recent, it restores the last tab (persisted to localStorage)
 * instead of defaulting to Home. A genuine quit-and-reopen sets no marker, so
 * it still lands on Home as intended.
 */
const KEY = 'badminton_excursion_at';

export function markExternalExcursion(): void {
  try {
    window.localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* localStorage unavailable — restore just won't bridge this excursion */
  }
}

/**
 * Returns true (once) if an excursion was marked within `maxAgeMs`. Always
 * clears the marker so it can't leak into a later, unrelated cold start.
 */
export function consumeRecentExcursion(maxAgeMs = 3 * 60_000): boolean {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return false;
    window.localStorage.removeItem(KEY);
    const t = Number(raw);
    return Number.isFinite(t) && Date.now() - t < maxAgeMs;
  } catch {
    return false;
  }
}
