'use client';

import { useEffect, useState } from 'react';
import { getIdentity, IDENTITY_EVENT } from '@/lib/identity';

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

  return (
    <div
      className="glass-card"
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, borderLeft: `3px solid ${ACCENT}` }}
      aria-label={hasStreak ? `${streak} week attendance streak for ${name}` : `Insight for ${name}`}
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
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: onPersonalBest ? '#fff' : ACCENT, lineHeight: 1 }}>
              {streak}
            </span>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 11, color: MUTED, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {onPersonalBest ? `${name} — Personal Best` : `${name}'s Streak`}
            </p>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: PRIMARY, lineHeight: 1.25, marginTop: 2 }}>
              {streak === 1 ? "You're on a 1-week streak" : `You're on a ${streak}-week streak`}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: MUTED, marginTop: 2 }}>
              {onPersonalBest
                ? `Tied or beating your longest run of ${longestStreak}.`
                : `Longest run: ${longestStreak} week${longestStreak === 1 ? '' : 's'}. Keep showing up.`}
            </p>
          </div>
        </div>
      )}

      {/* ── Body: passive AI insight (recap + focus) ── */}
      {showBody && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, ...(hasStreak ? { borderTop: '1px solid var(--inner-card-border)', paddingTop: 14 } : {}) }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-icons" aria-hidden="true" style={{ fontSize: 20, color: ACCENT }}>auto_fix_high</span>
              <h3 className="bpm-h3 m-0">Your read</h3>
            </div>
            <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 100, whiteSpace: 'nowrap', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', border: `1px solid ${ACCENT}`, color: ACCENT }}>
              Beta
            </span>
          </div>

          {insightLoading && !hasInsight ? (
            <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="animate-pulse" style={{ height: 12, borderRadius: 6, background: 'var(--inner-card-bg)', width: '90%' }} />
              <div className="animate-pulse" style={{ height: 12, borderRadius: 6, background: 'var(--inner-card-bg)', width: '70%' }} />
              <p style={{ margin: 0, fontSize: 11, color: MUTED }}>Reading the dots…</p>
            </div>
          ) : hasInsight ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {insight?.recap && <InsightSection label="Last week" body={insight.recap} />}
              {insight?.focus && <InsightSection label="This week · Focus" body={insight.focus} accent />}
            </div>
          ) : (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: MUTED }}>
              Couldn’t load your read — refresh to retry.
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
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent ? ACCENT : MUTED }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: PRIMARY }}>{body}</p>
    </div>
  );
}
