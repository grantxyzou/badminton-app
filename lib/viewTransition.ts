import { flushSync } from 'react-dom';

/**
 * Run a React state update inside a View Transition, when one is worth running.
 *
 * The browser snapshots the page, the update commits synchronously (hence
 * `flushSync`: an update React defers would land after the "new" snapshot and
 * the transition would animate nothing), and elements sharing a
 * `view-transition-name` across the two snapshots morph into each other.
 *
 * Returns whether a transition ran, so the caller can skip its own entrance
 * animation rather than play two at once. Falls back to a plain update:
 * - where the API does not exist (older Safari, Firefox, jsdom), and
 * - under `prefers-reduced-motion`, where a position-and-size morph is exactly
 *   the movement the setting asks to remove. The caller's own fallback entrance
 *   is opacity-led and the global reduced-motion rule already tames it.
 */
export function canViewTransition(): boolean {
  if (typeof document === 'undefined') return false;
  if (typeof vtDocument().startViewTransition !== 'function') return false;
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

/**
 * `onFinished` runs once the transition has settled (resolved OR rejected —
 * a skipped transition still lands the update), or straight after `update`
 * when no transition runs. It exists for work that must be SEEN, not just
 * committed: while a transition runs, Safari paints static snapshots of
 * both states, so anything animating inside the new DOM plays behind a
 * frozen picture — the sign-up shuttle burst was invisible on every iPhone
 * for exactly that reason (docs/plans/signup-shuttle-burst.md).
 */
export function withViewTransition(update: () => void, scope?: string, onFinished?: () => void): boolean {
  if (!canViewTransition()) {
    update();
    onFinished?.();
    return false;
  }
  /* `scope` goes on <html> for the life of the transition only, and the CSS
     hangs every `view-transition-name` off it. A name that is always present
     is not free: the element becomes a stacking context and a backdrop root,
     which changes how the glass cards' backdrop-filter composites on every
     ordinary render, not just during the one moment that animates. */
  const root = document.documentElement;
  if (scope) root.classList.add(scope);
  const transition = vtDocument().startViewTransition!(() => {
    flushSync(update);
  }) as { finished?: Promise<unknown> } | undefined;
  const clear = () => {
    if (scope) root.classList.remove(scope);
    onFinished?.();
  };
  if (transition?.finished) transition.finished.then(clear, clear);
  else clear();
  return true;
}

/** Typed as optional: lib.dom declares it, but not every browser has it. */
function vtDocument(): { startViewTransition?: (cb: () => void) => unknown } {
  return document as unknown as { startViewTransition?: (cb: () => void) => unknown };
}
