'use client';

import { useRef, type ReactNode } from 'react';
import { useScrollCondensed } from './useScrollCondensed';

/**
 * Tab-level page header. Wraps the canonical `<h1 className="bpm-h1">`
 * defined in `app/globals.css:382` (30px Space Grotesk, weight 700,
 * letter-spacing -0.02em, color from `--text-primary`).
 *
 * As of the 2026-05-06 TopBar Spec handoff, this is also a sticky
 * scroll-condensed bar — the spec's PageHeader variant used on
 * Profile / Home / Sign-Ups / Stats. Behavior: at-rest shows the
 * full bpm-h1 over a transparent bg; once scrollY > 8 the bar gets
 * a frosted backdrop and the title shrinks. See `bpm-page-header`
 * styles in `app/globals.css`.
 *
 * Replaces the previously duplicated literal:
 *   <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
 * which appeared in 8+ tab-level files and bypassed the design-system
 * token layer.
 *
 * If you need a new variant (e.g. centered on a sub-page), add a prop
 * here — DO NOT override styles inline at the call site, that's the
 * fragmentation we just removed.
 */
export interface PageHeaderProps {
  children: ReactNode;
  /**
   * Optional right-aligned slot — typically a small action button
   * (Sign out, version stamp, settings icon). Renders inline with the
   * heading at the same baseline.
   */
  action?: ReactNode;
  /**
   * Render the title small (17px, semibold) instead of the 30px bpm-h1.
   *
   * For a screen where the app's own name is orientation rather than content —
   * Home. A 30px bold wordmark on the home screen competes with the thing the
   * page exists for, and the user already knows which app they opened. At 17px
   * it still orients without taking the top of the visual hierarchy.
   *
   * A prop rather than an inline override at the call site, per this file's own
   * rule: overriding here is how the header fragmented across eight tabs before.
   */
  compact?: boolean;
}

export default function PageHeader({ children, action, compact = false }: PageHeaderProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Condense once the real scroll ancestor passes 8px. This app scrolls
  // <body> (not window) — see useScrollCondensed — so a window-only
  // listener (the previous impl) never fired and the frosted bar stayed dead.
  useScrollCondensed(ref);

  return (
    <div ref={ref} className="bpm-page-header">
      <h1
        className={`${compact ? 'bpm-page-header__title--compact' : 'bpm-h1'} bpm-page-header__title leading-tight`}
      >
        {children}
      </h1>
      {action && <div className="bpm-page-header__action shrink-0">{action}</div>}
    </div>
  );
}
