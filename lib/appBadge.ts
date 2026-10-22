/**
 * The red count on the app icon: how many lines a member owes
 * (docs/plans/native-badge-shortcuts.md).
 *
 * Two carriers, one rule. The store app sets it through the Badge plugin; the
 * web app installed on a home screen sets it through the Badging API
 * (`navigator.setAppBadge`, iOS 16.4+ and Chromium). A browser tab has neither
 * and nothing happens. Both need the notification permission push already
 * asked for — this never asks for it, because a badge is not worth a prompt.
 *
 * Imports nothing from Capacitor at the top: the plugin is a dynamic import
 * inside an `isNative()` branch (`__tests__/native-imports.test.ts`).
 */
import { hasNativePlugin, isNative } from './native';

interface OwedShape {
  sessions?: { settled?: boolean; selfReported?: boolean }[];
  stringing?: unknown[];
}

/**
 * Lines owed and FROZEN: settled sessions the member has not said they paid,
 * plus billable stringing charges. This week's session is not counted before
 * its bill goes out — a red 1 for a night not yet played reads as a debt that
 * does not exist yet.
 */
export function owedBadgeCount(data: OwedShape | null | undefined): number {
  if (!data) return 0;
  const sessions = (data.sessions ?? []).filter((s) => s.settled === true && s.selfReported !== true).length;
  const stringing = Array.isArray(data.stringing) ? data.stringing.length : 0;
  return sessions + stringing;
}

/**
 * Show `count` on the icon. Never throws, never prompts. Call it only with a
 * count from a read that SUCCEEDED: a failed read is unknown, not zero, and
 * clearing on one would tell someone who owes that they do not.
 */
export async function syncAppBadge(count: number): Promise<void> {
  const n = Math.max(0, Math.floor(count));
  try {
    if (isNative()) {
      // A binary that predates the plugin answers false: do nothing there.
      if (hasNativePlugin('Badge') === false) return;
      const { Badge } = await import('@capawesome/capacitor-badge');
      const { display } = await Badge.checkPermissions();
      if (display !== 'granted') return;
      const { count: current } = await Badge.get();
      if (current === n) return;
      // On iOS a zero badge also clears BPM's delivered notifications, so it
      // is reached only from a badge that was showing something — the moment
      // the last line is paid — never on every open.
      if (n === 0) await Badge.clear();
      else await Badge.set({ count: n });
      return;
    }
    const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    });
    if (!nav?.setAppBadge) return;
    if (n > 0) await nav.setAppBadge(n);
    else await nav.clearAppBadge?.();
  } catch {
    /* no permission, an older binary, a launcher without badges: no badge */
  }
}

/** Signing out: the next person on a shared phone must not see this count. */
export function clearAppBadge(): Promise<void> {
  return syncAppBadge(0);
}
