'use client';

import { useInsight } from '@/lib/useInsight';

/**
 * The single plain-language AI takeaway at the top of the Stats Summary — the
 * one-glance "where you're at + the one interesting thing" line. Leads the
 * distributed-insight surface (the per-card chips carry the non-obvious detail).
 *
 * Additive + legible-fail: renders nothing while loading, on error, or when
 * there's no greeting (anonymous viewer / no API key). The card below it always
 * stands on its own. Carries the conic AI rim (`.insight-rim`) + a Beta marker
 * so the AI provenance is honest.
 */
export default function SummaryGreeting() {
  const { data } = useInsight(true);
  const greeting = data?.greeting ?? null;
  if (!greeting) return null;

  return (
    <div
      className="glass-card insight-rim animate-fadeIn"
      style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}
      aria-label="Your AI summary"
    >
      <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--fs-stat-lg)', color: 'var(--accent, #22c55e)', flexShrink: 0 }}>
        auto_fix_high
      </span>
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{greeting}</p>
      <span
        style={{
          fontSize: 'var(--fs-2xs)',
          padding: '3px 8px',
          borderRadius: 'var(--radius-pill)',
          whiteSpace: 'nowrap',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          border: '1px solid var(--accent, #22c55e)',
          color: 'var(--accent, #22c55e)',
          flexShrink: 0,
        }}
      >
        Beta
      </span>
    </div>
  );
}
