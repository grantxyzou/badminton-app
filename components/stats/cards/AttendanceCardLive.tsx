'use client';

import { useEffect, useState } from 'react';
import { getIdentity } from '@/lib/identity';
import AttendanceSessionStrip, { recentSessions } from './AttendanceSessionStrip';

// 1Y window is the only view post-v1.3 hotfix — the 3M/6M zoom toggle was
// removed because cells got visually huge at narrow week counts and the
// zoom UI itself was occupying card real-estate. Heatmap is sized for the
// card area at this fixed window.
const WEEKS = 52;

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';
const ACCENT = 'var(--accent, #22c55e)';
const MUTED = 'var(--text-muted)';
const PRIMARY = 'var(--text-primary)';

interface AttendanceResponse {
  name: string;
  weeks: number;
  attended: number;
  streak: number;
  longestStreak: number;
  history: Array<{ sessionId: string; datetime: string | null; attended: boolean }>;
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

export default function AttendanceCardLive() {
  const [activeName, setActiveName] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const weeks = WEEKS;

  // Resolve active name once from localStorage.
  useEffect(() => {
    setActiveName(resolveActiveName());
    setResolved(true);
  }, []);

  // Fetch attendance whenever the active name changes.
  useEffect(() => {
    if (!activeName) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `${BASE}/api/stats/attendance?name=${encodeURIComponent(activeName)}&weeks=${weeks}`,
          { cache: 'no-store' },
        );
        if (!res.ok) {
          if (!cancelled) setData(null);
          return;
        }
        const payload = (await res.json()) as AttendanceResponse;
        if (!cancelled) setData(payload);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeName, weeks]);

  function clearPickedName() {
    try {
      localStorage.removeItem(STATS_NAME_KEY);
    } catch {
      /* ignore */
    }
    setActiveName(null);
    setData(null);
  }

  if (!resolved) {
    return <LoadingStrip weeks={weeks} />;
  }

  // No active name — passive prompt only. Sign-in / create-account live in
  // Profile; this card just describes what the user gets when authed.
  if (!activeName) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 13, color: PRIMARY, fontWeight: 600 }}>
          Your stats
        </p>
        <p style={{ margin: 0, fontSize: 12, color: MUTED, lineHeight: 1.45 }}>
          Sign in or create an account to see your personalized stats.
        </p>
      </div>
    );
  }

  if (loading && !data) return <LoadingStrip weeks={weeks} />;
  if (!data) {
    return (
      <p style={{ margin: 0, fontSize: 12, color: MUTED }} role="alert">
        Couldn’t load attendance.
      </p>
    );
  }

  const { streak } = data;
  const isPreviewPick = getIdentity()?.name?.toLowerCase() !== activeName.toLowerCase();

  // Recent-form framing: the last N sessions, and how many of *those* the
  // player made — more legible than "12 of 52 weeks" for a weekly game.
  const RECENT = 8;
  const recent = recentSessions(data.history, RECENT);
  const recentAttended = recent.filter((s) => s.attended).length;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: 12, color: MUTED, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Your recent form
        </p>
        {isPreviewPick && (
          <span style={{ fontSize: 11, color: MUTED }}>
            viewing as <strong style={{ color: PRIMARY }}>{activeName}</strong>{' '}
            <button
              type="button"
              onClick={clearPickedName}
              style={{ background: 'transparent', border: 'none', color: ACCENT, cursor: 'pointer', padding: 0, fontSize: 11 }}
            >
              change
            </button>
          </span>
        )}
      </div>
      <AttendanceSessionStrip history={data.history} limit={RECENT} />
      {recent.length > 0 && (
        <p style={{ margin: 0, fontSize: 13, color: PRIMARY }}>
          <strong>{recentAttended}</strong> of your last {recent.length}
          {streak >= 2 ? <span style={{ color: MUTED }}> · {streak}-session streak</span> : null}
        </p>
      )}
    </div>
  );
}

function LoadingStrip({ weeks }: { weeks: number }) {
  // Skeleton mirrors the session strip: a wrapping row of session-sized cells.
  const placeholder = Math.min(weeks, 16);
  return (
    <div style={{ display: 'grid', gap: 8, opacity: 0.4 }}>
      <div style={{ height: 26, background: 'var(--inner-card-bg)', borderRadius: 4, width: '40%' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {Array.from({ length: placeholder }).map((_, i) => (
          <div key={i} style={{ width: 16, height: 16, background: 'var(--inner-card-bg)', borderRadius: 4, flex: '0 0 auto' }} />
        ))}
      </div>
    </div>
  );
}
