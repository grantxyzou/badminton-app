'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity } from '@/lib/identity';
import type { CanonicalLevel } from '@/lib/level';
import { isFlagOn } from '@/lib/flags';
import { useInsight } from '@/lib/useInsight';
import InsightChip from '@/components/stats/InsightChip';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';

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

const CONF_COLOR: Record<CanonicalLevel['confidence'], string> = {
  low: 'var(--text-muted)',
  medium: 'var(--accent-amber, #f59e0b)',
  high: 'var(--accent, #22c55e)',
};

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
  const [showHow, setShowHow] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
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

  if (!activeName || !loaded) return null;

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className="glass-card p-5 space-y-3">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 22, color: 'var(--accent, #22c55e)', marginTop: 1 }}>
          emoji_events
        </span>
        <div>
          <h3 className="bpm-h3 m-0">{t('level.title')}</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0', lineHeight: 1.35 }}>{t('level.purpose')}</p>
        </div>
      </div>
      {children}
    </div>
  );

  if (state.kind === 'error') {
    return (
      <Frame>
        <p className="text-red-400 text-xs" role="alert">{t('level.error')}</p>
      </Frame>
    );
  }

  if (state.kind === 'needsAuth') {
    return (
      <Frame>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('level.needsAuth')}</p>
      </Frame>
    );
  }

  if (state.kind !== 'ok') return null;
  const { level } = state;

  // No level yet — surface the explanation's call-to-action, not a fake "0".
  if (level.level === null) {
    return (
      <Frame>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          {level.explanation[0] ?? t('level.empty')}
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        {level.phase && (
          <span
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 100, fontWeight: 600,
              letterSpacing: '0.04em', textTransform: 'uppercase',
              border: `1px solid ${level.phase === 'switch' ? 'var(--accent-amber)' : 'var(--accent)'}`,
              color: level.phase === 'switch' ? 'var(--accent-amber)' : 'var(--accent)',
              whiteSpace: 'nowrap',
            }}
          >
            {t(`assess.phase.${level.phase}`)}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginLeft: 'auto' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 30, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
            {level.level.toFixed(1)}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('level.ofFive')}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          aria-hidden="true"
          style={{ width: 8, height: 8, borderRadius: 100, background: CONF_COLOR[level.confidence], flexShrink: 0 }}
        />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {t(`level.confidence.${level.confidence}`)}
        </span>
      </div>

      {/* Phase 3: a higher phase the latest check-in reached but hysteresis
          hasn't confirmed — framed as encouragement, never a downgrade. */}
      {level.pendingPromotion && (
        <p
          style={{
            fontSize: 12, lineHeight: 1.45, margin: 0,
            color: 'var(--accent-amber, #f59e0b)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 16 }}>trending_up</span>
          {t('level.onTrack', { phase: t(`assess.phase.${level.pendingPromotion}`) })}
        </p>
      )}

      {/* Opt-in, asymmetric "blind spot": the comparison is revealed only on a
          deliberate tap, and the 'below' direction is reframed forward-looking
          with no deficit number (locked decision). */}
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
            <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', margin: 0 }}>
              {t(`level.compare.${level.blindSpot.direction}`)}
            </p>
          )}
        </div>
      )}

      {insightsOn && insight?.level && <InsightChip {...insight.level} />}

      {level.explanation.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowHow((v) => !v)}
            aria-expanded={showHow}
            className="cc-btn cc-btn-ghost"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {showHow ? t('level.hideDetails') : t('level.howTitle')}
          </button>
          {showHow && (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {level.explanation.map((line, i) => (
                <li key={i} style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Frame>
  );
}
