import { useEffect, RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Active traps, bottom to top. Only the TOP trap handles Tab and only the
 * trap that leaves an empty stack restores focus to where it came from —
 * the same reference-counting `useBodyScrollLock` does, for the same reason:
 * a sheet swap holds two of these for ~220 ms. Per-instance cleanups let the
 * closing sheet's trap yank focus to the rail card BEHIND the open sheet, and
 * the open sheet's Tab wrap only intervenes at its first/last focusable, so a
 * keyboard user then tabbed through the page beneath a modal.
 */
const stack: HTMLElement[] = [];
/** Where focus was when the FIRST trap opened — the only place the LAST
 *  release should send it. A later trap's own "previously focused" is the
 *  earlier sheet's first button (the fit sheet captured the pick sheet's Fit
 *  link), which is gone by the time it releases. */
let origin: HTMLElement | null = null;

/**
 * Traps Tab/Shift+Tab focus inside `containerRef` while `active` is true.
 * On activation, focus moves to the first focusable element inside the container.
 * On deactivation, focus returns to `triggerRef` (or document.activeElement at
 * activation time as fallback) — unless another trap is still open, in which
 * case focus goes back INTO that one.
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  triggerRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    if (stack.length === 0) {
      origin = (triggerRef?.current as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
    }
    stack.push(container);
    focusFirst(container);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !container) return;
      if (stack[stack.length - 1] !== container) return;
      const items = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const i = stack.lastIndexOf(container);
      if (i >= 0) stack.splice(i, 1);
      const top = stack[stack.length - 1];
      if (top) {
        // Another sheet is still open: focus belongs to it, never to the page.
        if (!top.contains(document.activeElement)) focusFirst(top);
        return;
      }
      // Last one out restores the origin — if it still exists. Focusing a
      // detached node is a silent no-op, so check rather than guess.
      const back = origin;
      origin = null;
      if (back?.isConnected) back.focus?.();
    };
  }, [active, containerRef, triggerRef]);
}

function focusFirst(container: HTMLElement) {
  const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  if (focusables.length > 0) {
    focusables[0].focus();
  } else {
    container.setAttribute('tabindex', '-1');
    container.focus();
  }
}
