import type { ReactNode } from 'react';

/**
 * Tab-level page header. Wraps the canonical `<h1 className="bpm-h1">`
 * defined in `app/globals.css:368` (30px Space Grotesk, weight 700,
 * letter-spacing -0.02em, color from `--text-primary`).
 *
 * Replaces the previously duplicated literal:
 *   <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
 * which appeared in 8+ tab-level files and bypassed the design-system
 * token layer (the same disease as the BottomNav active-state pre-PR-#32).
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
}

export default function PageHeader({ children, action }: PageHeaderProps) {
  if (!action) {
    return <h1 className="bpm-h1 leading-tight px-2">{children}</h1>;
  }
  return (
    <div className="flex items-baseline justify-between gap-3 px-2">
      <h1 className="bpm-h1 leading-tight">{children}</h1>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
