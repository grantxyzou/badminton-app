'use client';

import { useEffect, useState } from 'react';
import { getIdentity } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';
const ACCENT = 'var(--accent, #22c55e)';
const MUTED = 'var(--text-muted)';
const PRIMARY = 'var(--text-primary)';

interface HeroData {
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

/**
 * Attendance streak hero. Renders only when an active name is known AND the
 * current streak is at least 1. Kept intentionally light — the full heatmap
 * and breakdown live in the Attendance card below.
 */
export default function StatsStreakHero() {
  const [data, setData] = useState<HeroData | null>(null);

  useEffect(() => {
    const name = resolveActiveName();
    if (!name) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${BASE}/api/stats/attendance?name=${encodeURIComponent(name)}&weeks=52`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled) return;
        setData({
          name: payload.name,
          streak: payload.streak ?? 0,
          longestStreak: payload.longestStreak ?? 0,
        });
      } catch {
        /* silent — hero just won't appear */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || data.streak < 1) return null;

  const { streak, longestStreak, name } = data;
  const onPersonalBest = streak >= longestStreak && streak >= 3;

  return (
    <div
      className="glass-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: 16,
        borderLeft: `3px solid ${ACCENT}`,
      }}
      aria-label={`${streak} week attendance streak for ${name}`}
    >
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
  );
}
