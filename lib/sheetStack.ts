/**
 * Which bottom sheets are open right now, top-most last.
 *
 * Exists for ONE consumer: the Android hardware back button. A sheet is a
 * modal layer, and back should close it before it does anything else — but
 * the tab is not in the URL (by design, see HomeShell) and a sheet is not a
 * history entry, so `history.back()` cannot know. `BottomSheet` registers
 * itself while open; `NativeBridge` asks this module first.
 *
 * Module state, not React state: the bridge runs outside any sheet's tree.
 */
const stack: Array<() => void> = [];

/** Register an open sheet's close handler. Returns the unregister. */
export function registerOpenSheet(onClose: () => void): () => void {
  stack.push(onClose);
  return () => {
    const i = stack.lastIndexOf(onClose);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Close the top-most open sheet. False when none is open. */
export function closeTopSheet(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
}

export function openSheetCount(): number {
  return stack.length;
}
