import { useRef } from 'react';

/**
 * `true` from the first render in which `open` is true, and for every render
 * after. It is the latch that lets a sheet be loaded with `next/dynamic` AND
 * keep its close animation: a sheet rendered as `{open && <Sheet />}` would
 * unmount on the frame it closed and skip the slide-out, and one rendered
 * unconditionally fetches its chunk on mount whether or not anyone ever taps.
 * Gated on this, the chunk is fetched on the FIRST open and the sheet stays
 * mounted afterwards, closing the way it always did.
 *
 * A ref written during render rather than state set in an effect: the parent
 * re-renders whenever `open` changes (it is the parent's own state), so there
 * is nothing to schedule, and no setState-in-effect to reason about.
 */
export function useEverOpened(open: boolean): boolean {
  const ever = useRef(false);
  if (open) ever.current = true;
  return ever.current;
}
