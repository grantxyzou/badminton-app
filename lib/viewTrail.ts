/**
 * A screen's trail of pages (docs/plans/back-navigation.md): opening a page
 * pushes it, Back pops ONE, so Back always returns to the page it came from.
 * The admin console and the Stringing bench both keep one; before 2026-11-05
 * each held only the current page and every Back went to the bottom.
 *
 * Pure, so the rules are tested without rendering a console.
 */

/** Open `next` above the trail. The bottom screen clears it; the page already on top is not stacked twice. */
export function pushView<V extends string>(trail: readonly V[], next: V, bottom: V): V[] {
  if (next === bottom) return [];
  if (trail[trail.length - 1] === next) return [...trail];
  return [...trail, next];
}

/** Back one page. */
export function popView<V extends string>(trail: readonly V[]): V[] {
  return trail.slice(0, -1);
}

/** The page on top, or the bottom screen. */
export function topView<V extends string>(trail: readonly V[], bottom: V): V {
  return trail[trail.length - 1] ?? bottom;
}
