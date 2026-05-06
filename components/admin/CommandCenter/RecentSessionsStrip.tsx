'use client';

import { useEffect, useState, useCallback } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface RecentSession {
  sessionId: string;
  date: string;
  attendanceCount: number;
  totalCost: number;
  paidPercent: number;
  anomalyCodes: string[];
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function RecentSessionsStrip() {
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/sessions/recent?limit=6`, { cache: 'no-store' });
      if (!res.ok) {
        setSessions([]);
        return;
      }
      const data = (await res.json()) as RecentSession[];
      setSessions(Array.isArray(data) ? data : []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return null;
  if (sessions.length === 0) {
    return (
      <section className="glass-card p-4 space-y-1 opacity-60" aria-label="Recent sessions">
        <h3 className="bpm-h3">Recent sessions</h3>
        <p className="text-xs text-gray-400">No archived sessions yet.</p>
      </section>
    );
  }

  return (
    <section className="glass-card p-4 space-y-3" aria-label="Recent sessions">
      <h3 className="bpm-h3">Recent sessions</h3>
      <ul className="flex gap-3 overflow-x-auto -mx-1 px-1 pb-1 snap-x snap-mandatory" role="list">
        {sessions.map((s) => (
          <li
            key={s.sessionId}
            className="flex-shrink-0 snap-start rounded-lg px-3 py-3 min-w-[140px]"
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <p className="text-xs text-gray-400">{fmtDate(s.date)}</p>
            <p className="bpm-h3 mt-1">{s.attendanceCount} <span className="text-xs text-gray-400 font-normal">players</span></p>
            <p className="text-xs text-gray-400 mt-1">{s.paidPercent}% paid</p>
            {s.anomalyCodes.length > 0 && (
              <p className="text-xs mt-1" style={{ color: '#fcd34d' }}>
                <span className="material-icons text-xs align-middle">warning</span> {s.anomalyCodes.length}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
