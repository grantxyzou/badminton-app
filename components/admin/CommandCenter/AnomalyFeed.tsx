'use client';

import { useEffect, useState, useCallback } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Anomaly {
  code: string;
  severity: 'info' | 'warning' | 'blocking';
  message: string;
  dismissable: boolean;
}

interface AnomalyFeedProps {
  /** Bumped by parent when something happens that should refetch (e.g. session edit). */
  refreshKey?: number;
}

export default function AnomalyFeed({ refreshKey = 0 }: AnomalyFeedProps) {
  const [items, setItems] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const [dismissError, setDismissError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/anomalies`, { cache: 'no-store' });
      if (!res.ok) {
        // 401 = not admin; render nothing (load failure is silent for the
        // signed-out path). For 5xx surface as load error.
        if (res.status >= 500) setLoadError(true);
        setItems([]);
        return;
      }
      const data = (await res.json()) as Anomaly[];
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setLoadError(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function dismiss(code: string) {
    if (dismissing.has(code)) return;
    setDismissing((prev) => new Set(prev).add(code));
    setDismissError(null);

    try {
      const res = await fetch(`${BASE}/api/session/dismiss-anomaly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setDismissError(code);
        return;
      }
      setItems((prev) => prev.filter((a) => a.code !== code));
    } catch {
      setDismissError(code);
    } finally {
      setDismissing((prev) => {
        const copy = new Set(prev);
        copy.delete(code);
        return copy;
      });
    }
  }

  if (loading) return null;
  if (items.length === 0 && !loadError) return null;

  if (loadError && items.length === 0) {
    return (
      <section
        className="glass-card p-3"
        aria-label="Anomalies"
        style={{
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.2)',
        }}
      >
        <p style={{ fontSize: 12, color: 'var(--color-red, #ef4444)', margin: 0 }}>
          Couldn&apos;t load anomalies — try refreshing.
        </p>
      </section>
    );
  }

  return (
    <section className="glass-card p-4 space-y-3" aria-label="Anomalies">
      <header className="flex items-center justify-between">
        <h3 className="bpm-h3">Heads up</h3>
        <span className="text-xs text-gray-400">{items.length}</span>
      </header>
      <ul className="space-y-2" role="list">
        {items.map((anomaly) => (
          <li
            key={anomaly.code}
            className="flex items-start gap-3 rounded-lg p-3"
            style={{
              background:
                anomaly.severity === 'blocking'
                  ? 'rgba(239, 68, 68, 0.12)'
                  : anomaly.severity === 'warning'
                    ? 'rgba(245, 158, 11, 0.10)'
                    : 'rgba(255, 255, 255, 0.04)',
              border:
                anomaly.severity === 'blocking'
                  ? '1px solid rgba(239, 68, 68, 0.3)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <span
              className="material-icons text-base"
              aria-hidden="true"
              style={{
                color:
                  anomaly.severity === 'blocking'
                    ? '#fca5a5'
                    : anomaly.severity === 'warning'
                      ? '#fcd34d'
                      : '#9ca3af',
              }}
            >
              {anomaly.severity === 'blocking' ? 'error' : 'warning'}
            </span>
            <p className="flex-1 text-sm leading-relaxed">{anomaly.message}</p>
            {anomaly.dismissable && (
              <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                <button
                  type="button"
                  onClick={() => dismiss(anomaly.code)}
                  disabled={dismissing.has(anomaly.code)}
                  className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 disabled:opacity-50"
                  aria-label={`Dismiss ${anomaly.code}`}
                >
                  Dismiss
                </button>
                {dismissError === anomaly.code && (
                  <span style={{ fontSize: 10, color: 'var(--color-red, #ef4444)' }}>
                    Failed — retry
                  </span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
