'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

import { fmtShortDate as fmtDate } from '@/lib/fmt';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface RecentSession {
  sessionId: string;
  date: string;
  attendanceCount: number;
  totalCost: number;
  paidPercent: number;
  anomalyCodes: string[];
}

export default function RecentSessionsStrip() {
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDot, setActiveDot] = useState(0);
  const scrollRef = useRef<HTMLUListElement | null>(null);

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

  // Update dot indicator from scroll position.
  function handleScroll() {
    const el = scrollRef.current;
    if (!el || sessions.length === 0) return;
    const itemWidth = el.scrollWidth / sessions.length;
    if (itemWidth <= 0) return;
    const idx = Math.round(el.scrollLeft / itemWidth);
    setActiveDot(Math.max(0, Math.min(sessions.length - 1, idx)));
  }

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
      <ul
        ref={scrollRef}
        onScroll={handleScroll}
        className="cc-no-scrollbar flex gap-3 overflow-x-auto -mx-1 px-1 pb-1 snap-x snap-mandatory"
        role="list"
      >
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
            <p className="bpm-h3 mt-1">
              {s.attendanceCount} <span className="text-xs text-gray-400 font-normal">players</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">{s.paidPercent}% paid</p>
            {s.anomalyCodes.length > 0 && (
              <p className="text-xs mt-1" style={{ color: '#fcd34d' }}>
                <span className="material-icons text-xs align-middle">warning</span> {s.anomalyCodes.length}
              </p>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 && (
        <div className="flex justify-center gap-1.5 pt-1" aria-hidden="true">
          {sessions.map((_, i) => (
            <span
              key={i}
              className="rounded-full transition-all"
              style={{
                width: i === activeDot ? '14px' : '6px',
                height: '6px',
                background: i === activeDot ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)',
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
