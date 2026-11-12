'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** How far a finger must travel up the peek before it counts as a swipe, in px. */
const SWIPE_PX = 24;

/**
 * The quiet strip pinned above the tab bar under the strings map (the
 * Stringing canvas, idea B, 2026-11-12; Grant: "This should bring all the
 * interaction focus to the map. Not taking attention from it").
 *
 * It says one line and points back at the map: with nothing picked, "Tap a
 * dot on the map to see it here"; with a string picked, its name and the two
 * numbers that put it where it is on the map. A tap or an upward swipe opens
 * the rest (`onOpen`): the string's sheet, or the whole list when nothing is
 * picked. It never holds a second way to pick, so the eye stays on the dots.
 *
 * Fixed to the bottom of the screen, so it is portalled to the body (a
 * transformed ancestor would otherwise become its containing block) and sits
 * on the rail's measured height. It reports its own height, so the page can
 * keep its last content clear of it.
 */
export default function StringPeek({
  children,
  onOpen,
  openLabel,
  onHeight,
}: {
  children: ReactNode;
  onOpen: () => void;
  /** What a tap opens, for a screen reader ("Open Exbolt 63", "Show the list"). */
  openLabel: string;
  /** The peek's height in px, so the page can leave room for it. */
  onHeight?: (px: number) => void;
}) {
  const [rail, setRail] = useState(0);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // The rail's height is content plus its own safe-area padding, so it is
  // measured rather than restated.
  useLayoutEffect(() => {
    if (!mounted) return;
    const bar = document.querySelector<HTMLElement>('.rail-bar');
    if (!bar) return;
    const read = () => setRail(bar.offsetHeight);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [mounted]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onHeight) return;
    onHeight(el.offsetHeight);
  });

  if (!mounted) return null;
  return createPortal(
    <div ref={ref} className="string-peek" style={{ bottom: rail }} data-testid="string-peek">
      <button
        type="button"
        className="string-peek-tap"
        aria-label={openLabel}
        onClick={onOpen}
        onTouchStart={(e) => { startY.current = e.touches[0]?.clientY ?? null; }}
        onTouchMove={(e) => {
          const y0 = startY.current;
          const y = e.touches[0]?.clientY;
          if (y0 !== null && y !== undefined && y0 - y > SWIPE_PX) {
            startY.current = null;
            onOpen();
          }
        }}
        onTouchEnd={() => { startY.current = null; }}
      >
        <span aria-hidden="true" className="string-peek-grabber" />
        {children}
      </button>
    </div>,
    document.body,
  );
}
