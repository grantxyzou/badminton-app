'use client';

import { useTranslations } from 'next-intl';
import type { CardSlice } from '@/lib/useInsight';
import AIBadge from '@/components/primitives/AIBadge';

/**
 * A compact, styled AI-insight element attached to a Stats card — NOT a plain
 * text line. A `kind`-driven icon + a bold headline + an optional muted support
 * clause, on a subtle tinted surface. Short by construction (the API caps the
 * text length). Renders only when its card slice is present; the parent card's
 * core content always stands on its own.
 *
 * `kind` maps to a glyph already in the Material Symbols subset (app/layout.tsx)
 * — never introduce a kind whose icon isn't in that list or it renders as raw
 * text. Falls back to the generic AI glyph.
 */

/* `blindspot` and `phase-gating` were the level card's kinds; both left with
   it. `sticky-weak` is the only kind a chip can carry now — the map stays
   because the fallback below is what keeps an unknown kind from rendering a
   glyph name as raw text. */
const ICON_BY_KIND: Record<string, string> = {
  'sticky-weak': 'school',
};

const ACCENT = 'var(--accent, #22c55e)';

export default function InsightChip({ headline, support, kind }: CardSlice) {
  const t = useTranslations('stats');
  const icon = ICON_BY_KIND[kind] ?? 'auto_fix_high';
  return (
    <div
      className="animate-fadeIn"
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '10px 12px',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--inner-card-bg)',
        border: '1px solid var(--inner-card-border)',
      }}
    >
      <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: ACCENT, marginTop: 1, flexShrink: 0 }}>
        {icon}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35 }}>{headline}</p>
        {support && <p style={{ margin: '2px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.4 }}>{support}</p>}
      </div>
      {/* The same marker the summary greeting wears. This was a hand-rolled
          accent-outlined pill — same word, same aria-label, different look —
          so the Stats tab showed two AI markers in two visual languages a few
          hundred pixels apart, and a reader could not tell whether they meant
          the same thing. They do, so they look the same. */}
      <span style={{ flexShrink: 0 }}>
        <AIBadge label={t('insightChip.aiGenerated')}>{t('insightChip.aiBadge')}</AIBadge>
      </span>
    </div>
  );
}
