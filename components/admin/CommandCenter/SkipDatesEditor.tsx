'use client';

import { useEffect, useState, useCallback } from 'react';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import EmptyState from '@/components/primitives/EmptyState';
import StateCard, { StateLink } from '@/components/primitives/StateCard';
import CardHeader from '@/components/primitives/CardHeader';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function SkipDatesEditor() {
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /* 'failed' and 'refused' are NOT an empty list. Rendering "No skip dates yet"
     off a dead fetch was a lying empty state — and worse here, because the
     next Add would PATCH `[newDate]` over the real list. While either is set
     the input and the list are not rendered at all, so there is nothing to
     save from. */
  const [loadState, setLoadState] = useState<'ok' | 'failed' | 'refused'>('ok');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        setLoadState('refused');
        return;
      }
      if (!res.ok) {
        setLoadState('failed');
        return;
      }
      const data = (await res.json()) as { skipDates?: string[] };
      setDates(Array.isArray(data.skipDates) ? data.skipDates : []);
      setLoadState('ok');
    } catch {
      setLoadState('failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function persist(next: string[]) {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipDates: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Failed to save');
        // Roll back
        await load();
        return;
      }
      setDates(next);
    } catch {
      setError('Network error');
      await load();
    } finally {
      setSaving(false);
    }
  }

  function addDate() {
    const d = adding.trim();
    if (!DATE_RE.test(d)) {
      setError('Use format YYYY-MM-DD');
      return;
    }
    if (dates.includes(d)) {
      setError('Already on the list');
      return;
    }
    const next = [...dates, d].sort();
    setAdding('');
    void persist(next);
  }

  function removeDate(d: string) {
    const next = dates.filter((x) => x !== d);
    void persist(next);
  }

  if (loading) return <CardSkeleton height={140} />;

  // A failed load tints the card (Grant, 2026-09-14) and shows the list's
  // shape with nothing in it; the date field is not rendered, so nothing can
  // be saved over the real list.
  if (loadState === 'failed') {
    return (
      <StateCard
        tone="danger"
        icon="calendar_today"
        title="Skip dates"
        subtitle="Dates the system will warn you about when advancing — holidays, travel, venue closures."
        message={
          <>
            Couldn&apos;t load your skip dates. <StateLink onClick={() => void load()}>Try again</StateLink>
          </>
        }
      >
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <span className="state-line" style={{ width: '28%', height: 'var(--space-6)' }} />
          <span className="state-line" style={{ width: '28%', height: 'var(--space-6)' }} />
        </div>
      </StateCard>
    );
  }

  return (
    <section className="glass-card p-4 space-y-3 motion-fade" aria-label="Skip dates">
      <CardHeader
        icon="calendar_today"
        title="Skip dates"
        subtitle="Dates the system will warn you about when advancing — holidays, travel, venue closures."
      />

      {loadState === 'refused' && (
        <EmptyState
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
              Try again
            </button>
          }
        >
          Sign in as an admin to see skip dates.
        </EmptyState>
      )}

      {loadState === 'ok' && (
        <>
          <div className="flex gap-2">
            <input
              type="date"
              value={adding}
              onChange={(e) => { setAdding(e.target.value); setError(''); }}
              className="flex-1 fs-md rounded-lg p-2"
              style={{ background: 'rgba(var(--glass-tint), 0.04)', border: '1px solid rgba(var(--glass-tint), 0.12)' }}
            />
            <button
              type="button"
              onClick={addDate}
              disabled={saving || !adding}
              className="cc-btn cc-btn-secondary"
            >
              Add
            </button>
          </div>

          {error && <p className="field-error" role="alert">{error}</p>}

          {dates.length > 0 && (
            <ul className="flex flex-wrap gap-2" role="list">
              {dates.map((d) => (
                <li
                  key={d}
                  className="fs-sm px-3 py-1 rounded-full inline-flex items-center gap-1"
                  style={{ background: 'rgba(var(--glass-tint), 0.04)', border: '1px solid rgba(var(--glass-tint), 0.12)' }}
                >
                  {d}
                  <button
                    type="button"
                    onClick={() => removeDate(d)}
                    disabled={saving}
                    className="text-gray-400 hover:text-red-400 disabled:opacity-50"
                    aria-label={`Remove ${d}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {dates.length === 0 && (
            <p className="fs-sm text-gray-500">No skip dates yet.</p>
          )}
        </>
      )}
    </section>
  );
}
