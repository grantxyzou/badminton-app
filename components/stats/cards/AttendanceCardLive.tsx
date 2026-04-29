'use client';

import { useEffect, useState, useMemo } from 'react';
import { getIdentity } from '@/lib/identity';
import RecoverySheet from '@/components/RecoverySheet';
import AttendanceHeatmap from './AttendanceHeatmap';

type Zoom = { label: string; weeks: number };
const ZOOMS: Zoom[] = [
  { label: '3M', weeks: 13 },
  { label: '6M', weeks: 26 },
  { label: '1Y', weeks: 52 },
];

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

interface AttendanceCardLiveProps {
  onSignUp?: () => void;
}

export default function AttendanceCardLive({ onSignUp }: AttendanceCardLiveProps = {}) {
  const [activeName, setActiveName] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [zoomIdx, setZoomIdx] = useState(0); // default 3M
  const [data, setData] = useState<AttendanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [pickerValue, setPickerValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState('');

  const weeks = ZOOMS[zoomIdx].weeks;

  // Resolve active name once from localStorage.
  useEffect(() => {
    setActiveName(resolveActiveName());
    setResolved(true);
  }, []);

  // Lazily fetch active session id only if we'll need to open RecoverySheet.
  useEffect(() => {
    if (activeName) return;
    fetch(`${BASE}/api/session`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { id?: string } | null) => {
        if (s?.id) setActiveSessionId(s.id);
      })
      .catch(() => undefined);
  }, [activeName]);

  // Load member names for autocomplete (public endpoint, no auth needed).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/members`, { cache: 'no-store' });
        if (!res.ok) return;
        const payload = await res.json();
        const list = Array.isArray(payload?.members) ? payload.members : payload;
        if (cancelled) return;
        const names = (list as Array<{ name?: string }>)
          .map((m) => m?.name)
          .filter((n): n is string => typeof n === 'string' && n.length > 0);
        setMembers(names);
      } catch {
        /* autocomplete is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
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

  const suggestions = useMemo(() => {
    const q = pickerValue.trim().toLowerCase();
    if (!q) return members.slice(0, 6);
    return members.filter((n) => n.toLowerCase().includes(q)).slice(0, 6);
  }, [members, pickerValue]);

  function confirmName(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      localStorage.setItem(STATS_NAME_KEY, trimmed);
    } catch {
      /* ignore */
    }
    setActiveName(trimmed);
    setPickerValue('');
    setShowSuggestions(false);
  }

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

  // No active name — your stats only. No look-up affordance for other players.
  if (!activeName) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 13, color: PRIMARY, fontWeight: 600 }}>
          Your stats
        </p>
        <p style={{ margin: 0, fontSize: 12, color: MUTED, lineHeight: 1.45 }}>
          Sign up for a session to start tracking your attendance, or sign in if you played here before.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {onSignUp && (
            <button
              type="button"
              onClick={onSignUp}
              className="btn-primary"
              style={{ minHeight: 36, padding: '0 14px', fontSize: 13 }}
            >
              Sign up
            </button>
          )}
          <button
            type="button"
            onClick={() => setRecoveryOpen(true)}
            className="btn-ghost"
            style={{ minHeight: 36, padding: '0 14px', fontSize: 13 }}
          >
            Sign in
          </button>
        </div>
        {recoveryFlag && (
          <RecoverySheet
            open={recoveryOpen}
            onClose={() => setRecoveryOpen(false)}
            sessionId={activeSessionId}
          />
        )}
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

  const { attended, streak, longestStreak, weeks: w } = data;
  const isPreviewPick = getIdentity()?.name?.toLowerCase() !== activeName.toLowerCase();

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, color: PRIMARY }}>
          {attended}
          <span style={{ fontSize: 13, fontWeight: 500, color: MUTED, marginLeft: 6 }}>of {w} weeks</span>
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
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }} role="tablist" aria-label="Time window">
        {ZOOMS.map((z, i) => {
          const active = i === zoomIdx;
          return (
            <button
              key={z.label}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setZoomIdx(i)}
              style={{
                minHeight: 28,
                padding: '2px 10px',
                borderRadius: 100,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.04em',
                border: `1px solid ${active ? ACCENT : 'var(--inner-card-border)'}`,
                background: active ? 'color-mix(in oklab, var(--accent, #22c55e) 15%, transparent)' : 'transparent',
                color: active ? ACCENT : MUTED,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {z.label}
            </button>
          );
        })}
      </div>
      <AttendanceHeatmap history={data.history} weeks={w} />
      {buildSubText(attended, w, streak, longestStreak) && (
        <p style={{ margin: 0, fontSize: 11, color: MUTED }}>{buildSubText(attended, w, streak, longestStreak)}</p>
      )}
    </div>
  );
}

function LoadingStrip({ weeks }: { weeks: number }) {
  const totalDays = weeks * 7;
  return (
    <div style={{ display: 'grid', gap: 8, opacity: 0.4 }}>
      <div style={{ height: 26, background: 'var(--inner-card-bg)', borderRadius: 4, width: '40%' }} />
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${weeks}, 1fr)`, gap: 2 }}>
        {Array.from({ length: totalDays }).map((_, i) => (
          <div key={i} style={{ aspectRatio: '1 / 1', background: 'var(--inner-card-bg)', borderRadius: 2 }} />
        ))}
      </div>
    </div>
  );
}

function buildSubText(attended: number, weeks: number, streak: number, longest: number): string {
  if (attended === 0) return 'No sessions played yet in this window.';
  if (streak === weeks) return 'Perfect attendance — every session.';
  if (longest > streak && longest > 2) return `Longest run: ${longest} in a row.`;
  if (streak >= 3) return `${streak} sessions in a row — keep it going.`;
  return '';
}
