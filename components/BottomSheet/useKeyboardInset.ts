'use client';

import { useEffect } from 'react';

/**
 * Keep an open sheet ABOVE the on-screen keyboard.
 *
 * A sheet is `position: fixed; bottom: 0`. On iOS the keyboard does not resize
 * the layout viewport — it covers it — so a sheet you are typing into keeps its
 * bottom edge, and its pinned footer (where the primary action lives), under
 * the keyboard. You can type the name and not reach the button that saves it.
 *
 * `visualViewport` is the one thing that knows how much of the screen is
 * actually visible. The gap between the layout height and the visible height
 * is the keyboard; this writes it onto the sheet as `--keyboard-inset` (and the
 * visible height as `--visible-height`) and marks it `data-keyboard`, and CSS
 * lifts the sheet and caps its height to what is left. Written straight to
 * the element, like the drag: no render per viewport event.
 *
 * Android is mostly handled by `interactiveWidget: 'resizes-content'` in the
 * viewport export, which makes Chrome shrink the layout viewport itself — the
 * gap measured here is then ~0 and nothing is lifted twice.
 *
 * Also scrolls the focused field into view inside the sheet body once the
 * keyboard has settled, because lifting the sheet does not move a field that
 * was already below the new visible edge.
 */

/** Below this the gap is a browser toolbar showing or hiding, not a keyboard. */
export const KEYBOARD_MIN_PX = 120;

export function keyboardInset(innerHeight: number, vv: { height: number; offsetTop: number }): number {
  const gap = Math.round(innerHeight - vv.height - vv.offsetTop);
  return gap >= KEYBOARD_MIN_PX ? gap : 0;
}

export function useKeyboardInset(active: boolean, sheetRef: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const sheet = sheetRef.current;
    if (!active || !vv || !sheet) return;

    const apply = () => {
      const inset = keyboardInset(window.innerHeight, vv);
      if (inset > 0) {
        sheet.style.setProperty('--keyboard-inset', `${inset}px`);
        sheet.style.setProperty('--visible-height', `${Math.round(vv.height)}px`);
        sheet.dataset.keyboard = 'true';
      } else {
        sheet.style.removeProperty('--keyboard-inset');
        sheet.style.removeProperty('--visible-height');
        delete sheet.dataset.keyboard;
      }
    };

    // The keyboard slides in over ~300ms and the viewport settles after it; a
    // field scrolled into view before then is scrolled against the old size.
    let settle: ReturnType<typeof setTimeout> | null = null;
    const onFocusIn = (e: FocusEvent) => {
      const field = e.target as HTMLElement | null;
      if (!field || !field.matches('input, textarea, select')) return;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        if (document.activeElement === field) field.scrollIntoView({ block: 'nearest' });
      }, 320);
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    sheet.addEventListener('focusin', onFocusIn);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      sheet.removeEventListener('focusin', onFocusIn);
      if (settle) clearTimeout(settle);
      sheet.style.removeProperty('--keyboard-inset');
      sheet.style.removeProperty('--visible-height');
      delete sheet.dataset.keyboard;
    };
  }, [active, sheetRef]);
}
