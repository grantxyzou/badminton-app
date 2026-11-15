/**
 * The ONE definition of "an open foldable, two pages": the same condition as
 * the two-pane @media block in app/globals.css, verbatim (the foldable canary
 * pins the two together). Read by `usePaneMode` / `usePaneFlip`
 * (lib/paneMode.ts) and by the pre-paint size factor (lib/uiScale.ts).
 * Plain module, no 'use client': the server layout imports it.
 */
export const PANE_QUERY =
  '(min-width: 720px) and (min-height: 480px) and (pointer: coarse), (horizontal-viewport-segments: 2)';
