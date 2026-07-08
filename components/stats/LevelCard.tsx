'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { getIdentity } from '@/lib/identity';
import type { CanonicalLevel } from '@/lib/level';
import { isFlagOn } from '@/lib/flags';
import { useInsight } from '@/lib/useInsight';
import InsightChip from '@/components/stats/InsightChip';
import CardHeader from '@/components/primitives/CardHeader';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import StatCard from '@/components/stats/StatCard';
import { SKILLS, topStrengths, workOnNext, type Rating } from '@/lib/assessment';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';
const SKILL_BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));

/** Same identity chain as the other stats cards: real identity → stats
 *  preview-name → null. Real identity wins so the level keys to the real player. */
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

type LoadState =
  | { kind: 'idle' }
  | { kind: 'ok'; level: CanonicalLevel }
  | { kind: 'error' }
  | { kind: 'needsAuth' };

/**
 * Private "Your level" card — the canonical 1–5 read folded from the member's
 * self check-ins (+ legacy stage fallback). Legible-fail throughout: an explicit
 * error pill on load failure and an actionable "sign in again" state on 403,
 * never a confident-but-wrong zero (lying-empty-state rule).
 */
export default function LevelCard() {
  const t = useTranslations('stats');
  const [activeName, setActiveName] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [loaded, setLoaded] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  // The one-line "read" (sharpest skill → next focus) folded from the latest
  // self-assessment; the standalone "your game over time" read was merged here.
  const [read, setRead] = useState<{ strength: string | null; focus: string | null }>({ strength: null, focus: null });
  // Distributed AI insight — a short, non-obvious chip about the level. Shared
  // (memoized) fetch across the greeting + the other card chips.
  const insightsOn = isFlagOn('NEXT_PUBLIC_FLAG_INSIGHT_CARDS');
  const { data: insight } = useInsight(insightsOn);

  useEffect(() => {
    setActiveName(resolveActiveName());
  }, []);

  const load = useCallback(() => {
    if (!activeName) return;
    fetch(`${BASE}/api/stats/level?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 403) return { _needsAuth: true } as const;
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        if (d?._needsAuth) setState({ kind: 'needsAuth' });
        else if (d?.level) setState({ kind: 'ok', level: d.level as CanonicalLevel });
        else setState({ kind: 'error' });
        setLoaded(true);
      })
      .catch(() => {
        setState({ kind: 'error' });
        setLoaded(true);
      });
  }, [activeName]);

  useEffect(() => { load(); }, [load]);

  // Second, independent read: the latest self-assessment drives the one-line
  // "sharpest → next" summary that used to be its own card.
  useEffect(() => {
    if (!activeName) return;
    fetch(`${BASE}/api/assessments?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const snaps = (d?.assessments ?? []) as { ratings: Rating[] }[];
        const latest = snaps[snaps.length - 1];
        if (!latest) { setRead({ strength: null, focus: null }); return; }
        const s = topStrengths(latest.ratings)[0];
        const w = workOnNext(latest.ratings)[0];
        setRead({
          strength: s ? SKILL_BY_KEY.get(s.skillKey)?.label ?? null : null,
          focus: w ? SKILL_BY_KEY.get(w.skillKey)?.label ?? null : null,
        });
      })
      .catch(() => setRead({ strength: null, focus: null }));
  }, [activeName]);

  if (!activeName) return null;
  // Loading: reserve the card's footprint with a skeleton instead of a blank
  // gap (the Stats Summary used to render nothing here until data landed).
  if (!loaded) return <CardSkeleton height={120} />;

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="emoji_events" title={t('level.title')} subtitle={t('level.purpose')} />
      {children}
    </div>
  );

  if (state.kind === 'error') {
    return (
      <Frame>
        <ErrorState message={t('level.error')} />
      </Frame>
    );
  }

  if (state.kind === 'needsAuth') {
    return (
      <Frame>
        <EmptyState>{t('level.needsAuth')}</EmptyState>
      </Frame>
    );
  }

  if (state.kind !== 'ok') return null;
  const { level } = state;

  // No level yet — surface the explanation's call-to-action, not a fake "0".
  if (level.level === null) {
    return (
      <Frame>
        <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: 0 }}>
          {level.explanation[0] ?? t('level.empty')}
        </p>
      </Frame>
    );
  }

  const phaseLabel = level.phase ? t(`assess.phase.${level.phase}`) : null;
  const heroCaption = phaseLabel
    ? `${phaseLabel} · ${t(`level.confidence.${level.confidence}`)}`
    : t(`level.confidence.${level.confidence}`);
  const hasRead = !!read.strength && !!read.focus && read.strength !== read.focus;
  const hasDetail =
    hasRead || !!level.pendingPromotion || !!level.blindSpot || (insightsOn && !!insight?.level);

  return (
    // Stable wrapper carries the reveal so the fade plays once on load.
    <div className="animate-fadeIn space-y-3">
      <StatCard
        tone="accent"
        icon="emoji_events"
        label={t('level.title')}
        value={level.level.toFixed(1)}
        unit={t('level.ofFive')}
        caption={heroCaption}
        size="hero"
      />

      {hasDetail && (
        <div className="glass-card p-4 space-y-2">
          {/* The one-line read merged in from the old "your game over time" card. */}
          {hasRead && (
            <p style={{ fontSize: 'var(--fs-md)', lineHeight: 1.5, color: 'var(--text-primary)', margin: 0 }}>
              {t.rich('assess.readLede', {
                strength: read.strength ?? '',
                workOn: read.focus ?? '',
                b: (c) => <b style={{ color: 'var(--accent)', fontWeight: 600 }}>{c}</b>,
              })}
            </p>
          )}
          {/* A higher phase the latest check-in reached but hysteresis hasn't
              confirmed — framed as encouragement, never a downgrade. */}
          {level.pendingPromotion && (
            <p
              style={{
                fontSize: 'var(--fs-sm)', lineHeight: 1.45, margin: 0,
                color: 'var(--accent-amber, #f59e0b)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--fs-lg)' }}>trending_up</span>
              {t('level.onTrack', { phase: t(`assess.phase.${level.pendingPromotion}`) })}
            </p>
          )}

          {/* Opt-in, asymmetric "blind spot": revealed only on a deliberate tap. */}
          {level.blindSpot && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowCompare((v) => !v)}
                aria-expanded={showCompare}
                className="cc-btn cc-btn-ghost"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {showCompare ? t('level.compare.hide') : t('level.compare.cta')}
              </button>
              {showCompare && (
                <p style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.5, color: 'var(--text-secondary)', margin: 0 }}>
                  {t(`level.compare.${level.blindSpot.direction}`)}
                </p>
              )}
            </div>
          )}

          {insightsOn && insight?.level && <InsightChip {...insight.level} />}
        </div>
      )}
    </div>
  );
}
