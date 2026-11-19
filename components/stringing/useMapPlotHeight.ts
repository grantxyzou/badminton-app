'use client';

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { pageScrollTop } from '@/lib/pageScroll';
import { fitPlotHeight, MAP_PLOT_H } from '@/lib/stringMap';

/** Room kept under the card for the "For your <racket>" strip, whether or
 *  not it has arrived yet: the gap above it plus its two-line height on a
 *  phone. Budgeted up front so the map does not jump when the strip lands. */
const STRIP_RESERVE = 60;
/** The peek's one-line height, assumed until the card has measured it. */
const PEEK_REST_MIN = 52;

/**
 * How tall the strings map's plot can be so the WHOLE card, its strip and the
 * peek fit on this screen without scrolling (Grant, 2026-11-19: "iPhone pro
 * max displays the current height fine, but on iPhone pro or smaller androids
 * it's cutting off and require scrolling. I want to avoid that").
 *
 * The plot is the one part of the card that can give: everything else is
 * text and controls. So this measures where the content would end against
 * where it has to end for the page not to scroll — the screen's height less
 * the page's own bottom padding and the peek — and hands the plot whatever
 * remains (`fitPlotHeight` in `lib/stringMap.ts`, between `MAP_PLOT_MIN_H`
 * and `MAP_PLOT_H`). A screen with room to spare gets the designed height
 * and nothing more. Its width already follows
 * the card (`StringMap` measures it).
 *
 * Everything is read off the page (the top inset, the tab bar with its
 * home-indicator padding, the text size), never from a table of phones.
 *
 * The peek is budgeted AT REST (`peekRest`: its height with nothing picked),
 * so tapping a dot, which makes the peek a line taller, never resizes the
 * map; that is the state an iPhone Pro Max fits today, by 4px.
 *
 * The answer does not depend on the plot's current height (growing the plot
 * by a pixel moves the card's bottom by a pixel), so it settles in one pass
 * and a resize of the card it caused changes nothing.
 *
 * It holds still while the "How to choose a string" lesson is open: the
 * member asked for more to read, scrolling is expected, and a map that
 * shrank to make room would be the chart skipping about.
 */
export function useMapPlotHeight(
  cardRef: RefObject<HTMLElement | null>,
  stripRef: RefObject<HTMLElement | null>,
  /** The peek's height with nothing picked, in px; 0 until measured. */
  peekRest: number,
  /** Changes whenever something outside the card could have moved: the tab
   *  coming on screen, the strip arriving or changing its words. */
  layoutKey: string,
): number {
  const [height, setHeight] = useState(MAP_PLOT_H);

  const fit = useCallback(() => {
    const card = cardRef.current;
    const rail = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.rail-bar');
    const plot = card?.querySelector<HTMLElement>('[data-map-plot]');
    if (!card || !rail || !plot) return;
    if (card.querySelector('[data-map-lesson]')) return;
    const box = card.getBoundingClientRect();
    // A hidden tab measures nothing; it is fitted when it comes back.
    if (box.height === 0) return;
    const strip = stripRef.current;
    const under = strip ? Math.max(strip.getBoundingClientRect().bottom - box.bottom, STRIP_RESERVE) : STRIP_RESERVE;
    // What the page adds under the card's column: the shell's bottom padding
    // (the tab bar's clearance). The column's own margin is the peek's room,
    // budgeted at rest below instead of as it stands now.
    let tail = 0;
    for (let el = card.parentElement?.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const cs = getComputedStyle(el);
      tail += (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.marginBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    }
    const peek = Math.max(peekRest, PEEK_REST_MIN);
    // Where the content would end with the page at its top, against where
    // it has to end: so the page has nothing to scroll, and so the strip is
    // clear of the peek sitting on the tab bar.
    const next = fitPlotHeight({
      plotNow: plot.offsetHeight,
      contentEnd: box.bottom + pageScrollTop() + under,
      viewport: document.documentElement.clientHeight,
      tail,
      railTop: rail.getBoundingClientRect().top,
      peek,
    });
    setHeight((prev) => (prev === next ? prev : next));
  }, [cardRef, stripRef, peekRest]);

  // Before paint, so a short screen never shows the tall map first.
  useLayoutEffect(() => { fit(); }, [fit, layoutKey]);

  useEffect(() => {
    const card = cardRef.current;
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    // The card's own height moves when its content does (an axis row
    // appearing, the lesson closing); the tab bar's when the safe area does.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    if (card) ro?.observe(card);
    const rail = document.querySelector('.rail-bar');
    if (rail) ro?.observe(rail);
    return () => {
      window.removeEventListener('resize', fit);
      window.visualViewport?.removeEventListener('resize', fit);
      ro?.disconnect();
    };
    // Re-attached with the key: the card element mounts only once the shelf is ready.
  }, [fit, cardRef, layoutKey]);

  return height;
}
