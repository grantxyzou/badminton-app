'use client';

import { useEffect, useState } from 'react';
import { getIdentity, IDENTITY_EVENT } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';
const ACCENT = 'var(--accent, #22c55e)';
const MUTED = 'var(--text-muted)';
const PRIMARY = 'var(--text-primary)';

/**
 * Combined streak + AI "quick read" card for the Stats tab. Merges what were
 * two stacked cards (StatsStreakHero + WeeklySummaryCard) into one: the
 * attendance streak is the headline, the once-weekly AI summary is the body.
 *
 * Visibility: renders whenever an active name is known. The streak headline
 * sub-block only appears when the streak is >= 1 (a brand-new player just sees
 * the quick-read prompt). Active name resolves identity -> stats-preview-pick,
 * matching AttendanceCardLive / the old two cards.
 *
 * The AI summary calls Claude (Haiku) at most once per (name, week) and caches
 * the result in localStorage, so revisits within the week are zero-token.
 */

interface StreakData {
  name: string;
  streak: number;
  longestStreak: number;
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

function mondayOfThisWeek(): string {
  const d = new Date();
  const day = d.getDay(); // 0 = Sunday
  const stepBack = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - stepBack);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function summaryCacheKey(name: string): string {
  return `bpm_stats_summary_${name.toLowerCase()}_week_${mondayOfThisWeek()}`;
}

export default function StreakSummaryCard() {
  const [activeName, setActiveName] = useState<string | null>(null);
  const [streakData, setStreakData] = useState<StreakData | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve the active name (+ cached summary) and re-resolve on identity change.
  useEffect(() => {
    function refresh() {
      const name = resolveActiveName();
      setActiveName(name);
      if (!name) {
        setSummary(null);
        setStreakData(null);
        return;
      }
      try {
        const cached = localStorage.getItem(summaryCacheKey(name));
        setSummary(cached || null);
      } catch {
        setSummary(null);
      }
    }
    refresh();
    window.addEventListener(IDENTITY_EVENT, refresh);
    return () => window.removeEventListener(IDENTITY_EVENT, refresh);
  }, []);

  // Fetch the streak whenever the active name changes.
  useEffect(() => {
    if (!activeName) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${BASE}/api/stats/attendance?name=${encodeURIComponent(activeName)}&weeks=52`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled) return;
        setStreakData({
          name: payload.name ?? activeName,
          streak: payload.streak ?? 0,
          longestStreak: payload.longestStreak ?? 0,
        });
      } catch {
        /* silent — the streak headline just won't appear */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeName]);

  async function generate() {
    if (!activeName) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/stats/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: activeName }),
      });
      if (res.status === 429) {
        setError('Too many requests. Try again later.');
        return;
      }
      if (!res.ok) {
        setError('AI is unavailable. Try again later.');
        return;
      }
      const data = (await res.json()) as { summary?: string };
      if (!data.summary) {
        setError('No summary returned.');
        return;
      }
      setSummary(data.summary);
      try {
        localStorage.setItem(summaryCacheKey(activeName), data.summary);
      } catch {
        /* ignore — caching is opportunistic */
      }
    } catch {
      setError('Network error. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  if (!activeName) return null;

  const streak = streakData?.streak ?? 0;
  const longestStreak = streakData?.longestStreak ?? 0;
  const name = streakData?.name ?? activeName;
  const hasStreak = streak >= 1;
  const onPersonalBest = hasStreak && streak >= longestStreak && streak >= 3;

  return (
    <div
      className="glass-card"
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        borderLeft: `3px solid ${ACCENT}`,
      }}
      aria-label={hasStreak ? `${streak} week attendance streak for ${name}` : `Weekly read for ${name}`}
    >
      {/* ── Headline: attendance streak ── */}
      {hasStreak && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: onPersonalBest
                ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                : 'color-mix(in oklab, var(--accent, #22c55e) 24%, transparent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 22,
                fontWeight: 700,
                color: onPersonalBest ? '#fff' : ACCENT,
                lineHeight: 1,
              }}
            >
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

      {/* ── Body: AI quick read ── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          ...(hasStreak ? { borderTop: '1px solid var(--inner-card-border)', paddingTop: 14 } : {}),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-icons" aria-hidden="true" style={{ fontSize: 20, color: ACCENT }}>
              auto_fix_high
            </span>
            <h3 className="bpm-h3 m-0">This week&rsquo;s quick read</h3>
          </div>
          <span
            style={{
              fontSize: 10,
              padding: '3px 8px',
              borderRadius: 100,
              whiteSpace: 'nowrap',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              border: `1px solid ${ACCENT}`,
              color: ACCENT,
            }}
          >
            Beta
          </span>
        </div>

        {summary ? (
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: PRIMARY }}>{summary}</p>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
              One-tap AI read of your last year, generated once per week.
            </p>
            <button
              type="button"
              onClick={generate}
              disabled={loading}
              className="btn-ghost"
              style={{ alignSelf: 'flex-start', minHeight: 36, padding: '0 14px', fontSize: 14 }}
            >
              {loading ? 'Reading the dots…' : 'Generate'}
            </button>
            {error && (
              <p role="alert" style={{ margin: 0, fontSize: 12, color: MUTED }}>
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
