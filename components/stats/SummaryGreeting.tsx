'use client';

import { useTranslations } from 'next-intl';
import { useInsight } from '@/lib/useInsight';
import AIBadge from '@/components/primitives/AIBadge';
import ErrorState from '@/components/primitives/ErrorState';

/**
 * The single plain-language AI takeaway at the top of the Stats Summary — the
 * one-glance "where you're at + the one interesting thing" line. Leads the
 * distributed-insight surface (the per-card chips carry the non-obvious detail).
 *
 * Additive + legible-fail: renders nothing while loading, on an unknown load
 * failure, or when there's no greeting (anonymous viewer / no API key). The
 * card below it always stands on its own.
 *
 * Provenance is marked by `<AIBadge>` alone. The card used to wear the same
 * conic rainbow rim (`.insight-rim`) at full size, which spent the app's
 * loudest visual device on a footnote — a rainbow ring around a whole surface,
 * competing with the sentence inside it. An ordinary `.glass-card` with a
 * marked badge says the same thing at the right volume.
 *
 * A 403 is the ONE failure that does render. `/api/stats/insight` is
 * owner-or-admin gated, so a device with no `member_session` cookie for this
 * name gets refused — and staying silent there tells a member with a live
 * `badminton_identity` that they simply have no insight. Refreshing will never
 * fix that; signing in will, so the state has to say so. Unknown failures keep
 * rendering nothing (this component is additive, and "couldn't load" over a
 * card that is optional by design is noise).
 */
export default function SummaryGreeting() {
  const t = useTranslations('stats');
  const { data, forbidden } = useInsight(true);
  const greeting = data?.greeting ?? null;

  if (forbidden) return <ErrorState message={t('signInAgain')} />;
  if (!greeting) return null;

  return (
    <div
      className="glass-card animate-fadeIn"
      style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', alignItems: 'center', gap: 12 }}
      aria-label={t('summaryGreeting.ariaLabel')}
    >
      <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--fs-stat-lg)', color: 'var(--accent, #22c55e)', flexShrink: 0 }}>
        auto_fix_high
      </span>
      <p style={{ margin: 0, fontSize: 'var(--fs-lg)', lineHeight: 1.45, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>{greeting}</p>
      <span style={{ flexShrink: 0 }}>
        {/* Reuses InsightChip's string rather than adding a second copy of
            "AI generated" — both are stats AI-provenance labels under the same
            namespace. NOT `summaryGreeting.ariaLabel`, which the card itself
            already carries; repeating it would announce the surface twice. */}
        <AIBadge label={t('insightChip.aiGenerated')}>{t('summaryGreeting.ai')}</AIBadge>
      </span>
    </div>
  );
}
