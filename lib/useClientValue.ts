'use client';

import { useSyncExternalStore } from 'react';

/**
 * Read a browser-only value without a mount effect.
 *
 * The pattern this replaces was written a dozen times across the app:
 *
 *     const [ios, setIos] = useState(false);
 *     useEffect(() => { setIos(isIOS()); }, []);
 *
 * It is correct, but it renders twice on purpose and `react-hooks@7`'s React
 * Compiler ruleset flags every instance (`set-state-in-effect`). The compiler
 * cannot tell a deliberate post-hydration probe from an accidental cascading
 * render, so the whole class stays noisy and a real one hides among them.
 *
 * `useSyncExternalStore` is the API React ships for exactly this: it renders
 * `serverValue` on the server AND during hydration, then re-renders with
 * `read()` once hydration has committed. Same two-pass behaviour, same
 * hydration safety, no effect and no warning.
 *
 * **`serverValue` is the "unknown" answer, not a guess at the real one.** The
 * `lib/standalone.ts` / `lib/native.ts` contract is that `false` means "not
 * determined yet", never a confirmed negative, and callers already lean the
 * safe way on it. Keep that direction when choosing it here.
 *
 * **`read` must return a primitive** (or a cached reference). React calls it on
 * every render and compares with `Object.is`; a fresh object or array each time
 * is an infinite render loop. Every caller in this app returns a boolean,
 * string or null.
 *
 * For a value that can genuinely change while the page is open, pass a real
 * `subscribe` via {@link useClientSubscription} instead — this one is for
 * values that are fixed the moment the client is running.
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscribe, read, () => serverValue);
}

/** Nothing to subscribe to: the value cannot change after hydration. */
const noSubscribe = () => () => {};

/**
 * The same idea, but for a value backed by something that emits changes (a
 * media query, an event on `window`). `subscribe` is handed React's callback
 * and must return its own teardown.
 *
 * Keep `subscribe` referentially stable — define it at module scope or wrap it
 * in `useCallback` — or React resubscribes on every render.
 */
export function useClientSubscription<T>(
  subscribe: (onChange: () => void) => () => void,
  read: () => T,
  serverValue: T,
): T {
  return useSyncExternalStore(subscribe, read, () => serverValue);
}

/**
 * Has the client hydrated yet?
 *
 * `false` on the server and through hydration, `true` afterwards — the portal
 * guard that `BottomSheet` and friends need before touching `document.body`.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noSubscribe, readTrue, readFalse);
}

const readTrue = () => true;
const readFalse = () => false;

/**
 * Read a `localStorage` key, tolerating the private-mode throw.
 *
 * Unlike the mount-effect version this re-reads on every render, so a component
 * that re-renders after a write sees the new value. `ReleaseNotesTrigger` needed
 * a second effect to fake that and the two effects then raced each other.
 */
export function readStored(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    /* private mode / blocked storage — treat as unset */
    return null;
  }
}
