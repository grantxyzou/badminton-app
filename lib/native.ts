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
  isPluginAvailable?: (name: string) => boolean;
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

/**
 * Is `name` a plugin the binary the person is ACTUALLY RUNNING can serve?
 *
 * This is the question version skew creates, and it exists only because of
 * `server.url`: the shell loads the live web bundle, so the JS on their phone
 * is always as new as the last deploy while the binary is as old as the last
 * store release. Deploy code calling a plugin that shipped after their build
 * and the dynamic `import()` resolves (it is OUR chunk, not theirs) — then the
 * call throws `UNIMPLEMENTED` at the bridge. Asking first turns a dead control
 * into one that can explain itself.
 *
 * TRI-STATE, and that is the point. `null` means "cannot tell", which is NOT
 * `false`: callers disable UI on `false`, so collapsing the two would disable
 * a working button on any binary whose Capacitor predates `isPluginAvailable`.
 * Only act on an explicit `false`. Same rule as `isNative()` and
 * `lib/standalone.ts` — unknown is not a confirmed negative.
 *
 * Imports nothing, so it stays callable from the web bundle and from tests
 * that stub `window.Capacitor` (see `__tests__/native.test.ts`).
 */
export function hasNativePlugin(name: string): boolean | null {
  if (!isNative()) return null;
  try {
    const probe = capacitor()?.isPluginAvailable;
    if (typeof probe !== 'function') return null;
    return probe(name) === true;
  } catch {
    return null;
  }
}
