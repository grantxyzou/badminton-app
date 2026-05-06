'use client';

import { useEffect, useState, useCallback } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function SkipDatesEditor() {
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch from /api/members admin list since /api/members/me only returns role/hasPin.
      const res = await fetch(`${BASE}/api/members`, { cache: 'no-store' });
      if (res.ok) {
        const list = (await res.json()) as Array<{ role?: string; skipDates?: string[] }>;
        const me = list.find((m) => m.role === 'admin');
        setDates(me?.skipDates ?? []);
      }
    } catch {
      // ignore
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

  if (loading) return null;

  return (
    <section className="glass-card p-4 space-y-3" aria-label="Skip dates">
      <header>
        <h3 className="bpm-h3">Skip dates</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Dates the system will warn you about when advancing — holidays, travel, venue closures.
        </p>
      </header>

      <div className="flex gap-2">
        <input
          type="date"
          value={adding}
          onChange={(e) => { setAdding(e.target.value); setError(''); }}
          className="flex-1 text-sm rounded-lg p-2"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}
        />
        <button
          type="button"
          onClick={addDate}
          disabled={saving || !adding}
          className="text-xs px-3 py-1.5 rounded-full disabled:opacity-50"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
        >
          Add
        </button>
      </div>

      {error && <p className="text-xs text-red-400" role="alert">{error}</p>}

      {dates.length > 0 && (
        <ul className="flex flex-wrap gap-2" role="list">
          {dates.map((d) => (
            <li
              key={d}
              className="text-xs px-3 py-1 rounded-full inline-flex items-center gap-1"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}
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
        <p className="text-xs text-gray-500">No skip dates yet.</p>
      )}
    </section>
  );
}
