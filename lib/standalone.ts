/**
 * Is the app running as an installed standalone PWA (launched from the home
 * screen) rather than in a browser tab?
 *
 * - Android / desktop PWA: `display-mode: standalone` media query.
 * - iOS Safari home-screen apps: the non-standard `navigator.standalone`.
 *
 * Used to hide the "Add to Home Screen" hint once the app is already installed.
 * Returns `false` during SSR / before mount — callers should treat that as
 * "unknown, assume browser" (showing the hint to an installed user once is
 * harmless; hiding it from a browser user who needs it is not). Unknown is NOT
 * a confirmed negative: only `true` means definitely-installed.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if ((window.navigator as { standalone?: boolean }).standalone === true) return true;
  } catch {
    /* matchMedia can throw in odd embedded webviews — fall through */
  }
  return false;
}

/** True for iOS (iPhone/iPad/iPod), where install = Share → Add to Home Screen
 *  and there is never an automatic prompt. iPadOS 13+ reports as desktop Safari,
 *  so also treat a touch-capable "Macintosh" as iOS. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}
