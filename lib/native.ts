/**
 * Is this page running inside the Capacitor shell (the App Store / Play
 * build) rather than a browser or the installed PWA?
 *
 * The shell loads the LIVE web bundle via `server.url`, so it has no build of
 * its own and no build-time flag can tell it apart — detection is runtime.
 * Capacitor injects `window.Capacitor` before the page's scripts run.
 *
 * IMPORTS NOTHING. Every `@capacitor/*` package is loaded with a dynamic
 * `import()` INSIDE an `isNative()` branch at the call site, so the web bundle
 * gains only an unloaded chunk. `__tests__/native-imports.test.ts` enforces
 * that rule for the whole tree.
 *
 * Same contract as `lib/standalone.ts`: `false` during SSR / when unknown, and
 * "unknown is not a confirmed negative" — only `true` means definitely native.
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function capacitor(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap ?? null;
}

export function isNative(): boolean {
  try {
    return capacitor()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export type NativePlatform = 'ios' | 'android';

/** `null` on the web, during SSR, or for any platform we do not ship. */
export function nativePlatform(): NativePlatform | null {
  if (!isNative()) return null;
  try {
    const p = capacitor()?.getPlatform?.();
    return p === 'ios' || p === 'android' ? p : null;
  } catch {
    return null;
  }
}
