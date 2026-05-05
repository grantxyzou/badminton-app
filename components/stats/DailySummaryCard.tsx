'use client';

import { useEffect, useState } from 'react';
import { getIdentity, IDENTITY_EVENT } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';

/**
 * One-shot daily AI summary card for the Stats tab. Calls Claude (Haiku) at
 * most once per (name, today's date) — the result is cached in localStorage
 * so refreshing the page or reopening tomorrow doesn't re-spend tokens.
 *
 * The cache key is intentionally per-day (not per-week or per-session) so:
 *   - revisits within the same day cost zero tokens
 *   - tomorrow brings a fresh prompt anyway (one new data point)
 *
 * Resolves the active name in the same order as `AttendanceCardLive`:
 * identity → stats-preview-pick → null. If null, the card hides (no summary
 * to generate without a name).
 */

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cacheKey(name: string): string {
  return `bpm_stats_summary_${name.toLowerCase()}_${todayKey()}`;
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

export default function DailySummaryCard() {
  const [activeName, setActiveName] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve name + load cached summary if any.
  useEffect(() => {
    function refresh() {
      const name = resolveActiveName();
      setActiveName(name);
      if (!name) {
        setSummary(null);
        return;
      }
      try {
        const cached = localStorage.getItem(cacheKey(name));
        if (cached) setSummary(cached);
        else setSummary(null);
      } catch {
        setSummary(null);
      }
    }
    refresh();
    window.addEventListener(IDENTITY_EVENT, refresh);
    return () => window.removeEventListener(IDENTITY_EVENT, refresh);
  }, []);

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
        localStorage.setItem(cacheKey(activeName), data.summary);
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

  return (
    <div
      className="glass-card"
      style={{
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="material-icons"
            aria-hidden="true"
            style={{ fontSize: 20, color: 'var(--accent, #22c55e)' }}
          >
            auto_fix_high
          </span>
          <h3 className="text-base font-semibold m-0" style={{ color: 'var(--text-primary)', lineHeight: 1.2 }}>
            Today&rsquo;s quick read
          </h3>
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
            border: '1px solid var(--accent, #22c55e)',
            color: 'var(--accent, #22c55e)',
          }}
        >
          Beta
        </span>
      </div>

      {summary ? (
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-primary)' }}>
          {summary}
        </p>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
            One-tap AI read of your last year, generated once per day.
          </p>
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="btn-ghost"
            style={{ alignSelf: 'flex-start', minHeight: 36, padding: '0 14px', fontSize: 13 }}
          >
            {loading ? 'Reading the dots…' : 'Generate'}
          </button>
          {error && (
            <p role="alert" style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
