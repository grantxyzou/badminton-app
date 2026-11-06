/**
 * Coming back to the app is not opening it (docs/plans/startup-speed.md;
 * Grant, 2026-11-05: slow when "switching apps").
 *
 * iOS often drops the installed app while it is in the background, so coming
 * back from another app is a fresh page load, and the launch screen played
 * its whole shot again — about two seconds, most of it after Home was ready.
 * The app now notes, on this phone, the moment it was last in use (when it
 * goes to the background, and when it opens); a page load within
 * `QUICK_RETURN_MS` of that skips the launch screen. The pre-paint script in
 * `app/layout.tsx` reads the note before anything is drawn and marks
 * `<html data-launch="lifted" data-launch-skipped="return">`, so the splash
 * never shows; `LaunchScreen` sees it already hidden and stands down. A first
 * open of the day, or one after a long gap, keeps the full shot.
 *
 * Only the signed-in app writes the note (HomeShell), and sign-out forgets it
 * (`clearDeviceTraces`), so the signed-out Welcome keeps its own handoff.
 * Best-effort: storage may be off, and then every open is a fresh one.
 */
export const QUICK_RETURN_KEY = 'bpm_last_active';
export const QUICK_RETURN_MS = 30 * 60 * 1000;

export function noteActive(now = Date.now()): void {
  try { localStorage.setItem(QUICK_RETURN_KEY, String(now)); } catch { /* storage off */ }
}

export function forgetActive(): void {
  try { localStorage.removeItem(QUICK_RETURN_KEY); } catch { /* storage off */ }
}

/** Was the app in use on this phone within the last half hour? */
export function isQuickReturn(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(QUICK_RETURN_KEY));
    return Number.isFinite(at) && at > 0 && now - at >= 0 && now - at < QUICK_RETURN_MS;
  } catch {
    return false;
  }
}

/**
 * The same check, as the pre-paint script's source (it runs before any of the
 * app's code has loaded, so it cannot import this file). Kept beside
 * `isQuickReturn` and held to it by `__tests__/quick-return.test.ts`.
 */
export const QUICK_RETURN_PREPAINT =
  `try{var a=Number(localStorage.getItem('${QUICK_RETURN_KEY}')),n=Date.now();` +
  `if(isFinite(a)&&a>0&&n-a>=0&&n-a<${QUICK_RETURN_MS}){d.setAttribute('data-launch','lifted');d.setAttribute('data-launch-skipped','return')}}catch(e){}`;
