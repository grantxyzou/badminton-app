import { useEffect } from 'react';

/**
 * Locks body scroll using the position:fixed technique. Plain `overflow: hidden`
 * doesn't stop iOS rubber-band / pull-to-refresh — `position: fixed` pins the
 * body to its current scroll offset so no gesture can move it.
 *
 * Idempotent: cleanup restores the original styles each time.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [active]);
}
