'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity, IDENTITY_EVENT } from '@/lib/identity';
import CardHeader from '@/components/primitives/CardHeader';
import StatusBadge from '@/components/primitives/StatusBadge';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';
const ACCENT = 'var(--accent, #22c55e)';
const MUTED = 'var(--text-muted)';
const PRIMARY = 'var(--text-primary)';

/**
 * Combined streak + AI insight card. The attendance streak is the headline;
 * the body is the account-gated, server-cached insight (a "last week" recap +
 * a "this week · focus") fetched from /api/stats/insight.
 *
 * No CTA: the insight is generated passively server-side (once per member per
 * session) — this card just reads it. Anonymous viewers (non-members) see the
 * streak only, no insight.
 */

interface StreakData {
  name: string;
  streak: number;
  longestStreak: number;
}

interface InsightData {
  account: boolean;
  recap: string | null;
  focus: string | null;
}

function resolveActiveName(): string | null {
  const id = getIdentity();
  if (id?.name) return id.name;
  try {
    const stored = localStorage.getItem(STATS_NAME_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    /* ignore */
  }
  return null;
}

export default function StreakSummaryCard() {
  const t = useTranslations('stats');
  const [activeName, setActiveName] = useState<string | null>(null);
  const [streakData, setStreakData] = useState<StreakData | null>(null);
  const [insight, setInsight] = useState<InsightData | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState(false);

  useEffect(() => {
    function refresh() {
      setActiveName(resolveActiveName());
    }
    refresh();
    window.addEventListener(IDENTITY_EVENT, refresh);
    return () => window.removeEventListener(IDENTITY_EVENT, refresh);
  }, []);

  // Streak headline.
  useEffect(() => {
    if (!activeName) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/stats/attendance?name=${encodeURIComponent(activeName)}&weeks=52`, { cache: 'no-store' });
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled) return;
        setStreakData({ name: payload.name ?? activeName, streak: payload.streak ?? 0, longestStreak: payload.longestStreak ?? 0 });
      } catch {
        /* silent */
      }
    })();
    return () => { cancelled = true; };
  }, [activeName]);

  // Insight (passive). The endpoint returns cached text or generates once per
  // member per session — so this fetch is the "passive generation on first
  // app entry" trigger; repeat views are served from the server cache.
  useEffect(() => {
    if (!activeName) { setInsight(null); return; }
    let cancelled = false;
    setInsightLoading(true);
    setInsightError(false);
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/stats/insight?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as InsightData;
        if (cancelled) return;
        setInsight(data);
      } catch {
        if (!cancelled) setInsightError(true);
      } finally {
        if (!cancelled) setInsightLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeName]);

  if (!activeName) return null;

  const streak = streakData?.streak ?? 0;
  const longestStreak = streakData?.longestStreak ?? 0;
  const name = streakData?.name ?? activeName;
  const hasStreak = streak >= 1;
  const onPersonalBest = hasStreak && streak >= longestStreak && streak >= 3;

  const hasInsight = insight?.account && (insight.recap || insight.focus);
  // Show the body section while loading OR when there's an insight to render.
  const showBody = insightLoading || hasInsight || (insight?.account && insightError);
  // The read is actively being produced (spin + aria-busy).
  const generating = insightLoading && !hasInsight;
  // The AI gradient treatment only applies when there's an actual read — or
  // one is being generated. A streak-only card (no read) keeps a plain border,
  // so the gradient never implies AI content that isn't there.
  const showRim = insightLoading || !!hasInsight;

  // Nothing to show — no streak, no read, and not generating: render nothing
  // rather than an empty card shell.
  if (!hasStreak && !showBody) return null;

  return (
    <div
      // Conic gradient rim marks this as the AI surface (only when a read is
      // present/loading); `.is-generating` spins it while the read is produced,
      // freezing in place when it lands. See `.insight-rim` in globals.css.
      className={`glass-card${showRim ? ' insight-rim' : ''}${generating ? ' is-generating' : ''}`}
      style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}
      aria-busy={generating || undefined}
      aria-label={hasStreak ? t('streak.ariaStreak', { count: streak, name }) : t('streak.ariaInsight', { name })}
    >
      {/* ── Headline: attendance streak ── */}
      {hasStreak && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: '50%',
              background: onPersonalBest ? 'linear-gradient(135deg, #f59e0b, #ef4444)' : 'color-mix(in oklab, var(--accent, #22c55e) 24%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-stat-lg)', fontWeight: 700, color: onPersonalBest ? 'white' : ACCENT, lineHeight: 1 }}>
              {streak}
            </span>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: MUTED, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {onPersonalBest ? t('streak.personalBestLabel', { name }) : t('streak.streakLabel', { name })}
            </p>
            <p style={{ margin: 0, fontSize: 'var(--fs-lg)', fontWeight: 600, color: PRIMARY, lineHeight: 1.25, marginTop: 2 }}>
              {t('streak.streakLine', { count: streak })}
            </p>
            <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: MUTED, marginTop: 2 }}>
              {onPersonalBest
                ? t('streak.personalBestSub', { count: longestStreak })
                : t('streak.longestRunSub', { count: longestStreak })}
            </p>
          </div>
        </div>
      )}

      {/* ── Body: passive AI insight (recap + focus) ── */}
      {showBody && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, ...(hasStreak ? { borderTop: '1px solid var(--inner-card-border)', paddingTop: 14 } : {}) }}>
          <CardHeader icon="auto_fix_high" title={t('streak.readTitle')} badge={<StatusBadge>{t('streak.beta')}</StatusBadge>} />

          {insightLoading && !hasInsight ? (
            <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="animate-pulse" style={{ height: 12, borderRadius: 'var(--radius-xs)', background: 'var(--inner-card-bg)', width: '90%' }} />
              <div className="animate-pulse" style={{ height: 12, borderRadius: 'var(--radius-xs)', background: 'var(--inner-card-bg)', width: '70%' }} />
              <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: MUTED }}>{t('streak.reading')}</p>
            </div>
          ) : hasInsight ? (
            <div className="animate-fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {insight?.recap && <InsightSection label={t('streak.lastWeek')} body={insight.recap} />}
              {insight?.focus && <InsightSection label={t('streak.focus')} body={insight.focus} accent />}
            </div>
          ) : (
            <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: MUTED }}>
              {t('streak.readError')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function InsightSection({ label, body, accent }: { label: string; body: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <p style={{ margin: 0, fontSize: 'var(--fs-2xs)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent ? ACCENT : MUTED }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: 'var(--fs-md)', lineHeight: 1.5, color: PRIMARY }}>{body}</p>
    </div>
  );
}
