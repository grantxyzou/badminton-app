'use client';

import TopBar from '@/components/primitives/TopBar';
import type { AdminNavProps } from './types';

/**
 * Back-compat wrapper that delegates to the canonical `TopBar` primitive
 * (see `TopBar Spec.html` 2026-05-06 handoff). All seven admin sub-pages
 * (Roster, Birds, SessionDetails, DateTime, Releases, Members, Advance)
 * import this; routing them through `TopBar` gives them the sticky
 * scroll-condensed behavior without touching call sites.
 *
 * The `sessionLabel` chip — when present — renders in the right slot.
 */
export default function AdminBackHeader({ onBack, title, sessionLabel }: AdminNavProps) {
  const right = sessionLabel ? (
    <span
      className="text-[10px] font-semibold px-2 py-1 rounded-full"
      style={{
        background: 'var(--inner-card-green-bg)',
        color: 'var(--accent)',
        border: '1px solid var(--inner-card-green-border)',
      }}
    >
      {sessionLabel}
    </span>
  ) : undefined;

  return (
    <div className="animate-fadeIn">
      <TopBar title={title} crumb="Admin" onBack={onBack} right={right} />
    </div>
  );
}
