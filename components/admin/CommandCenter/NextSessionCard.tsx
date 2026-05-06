'use client';

import { useEffect, useState, useCallback } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Session {
  id: string;
  title?: string;
  datetime?: string;
  deadline?: string;
  courts?: number;
  maxPlayers?: number;
  signupOpen?: boolean;
  costPerCourt?: number;
}

interface Player {
  id: string;
  removed?: boolean;
  waitlisted?: boolean;
}

interface NextSessionCardProps {
  refreshKey?: number;
  onEdit?: () => void;
  onAdvance?: () => void;
  onEditDateTime?: () => void;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function fmtCountdown(deadline: string | undefined): string | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'closed';
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days >= 2) return `${days} days`;
  if (hours >= 1) return `${hours}h`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `${mins}m`;
}

export default function NextSessionCard({ refreshKey = 0, onEdit, onAdvance, onEditDateTime }: NextSessionCardProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [activeCount, setActiveCount] = useState<number>(0);
  const [waitlistCount, setWaitlistCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, playersRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
      ]);
      const s = sessionRes.ok ? ((await sessionRes.json()) as Session) : null;
      const players = playersRes.ok ? ((await playersRes.json()) as Player[]) : [];
      setSession(s);
      setActiveCount(players.filter((p) => !p.removed && !p.waitlisted).length);
      setWaitlistCount(players.filter((p) => !p.removed && p.waitlisted).length);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (loading) return null;
  if (!session) {
    return (
      <section className="glass-card p-4 space-y-1 opacity-60" aria-label="Next session">
        <h3 className="bpm-h3">Next session</h3>
        <p className="text-xs text-gray-400">No active session.</p>
      </section>
    );
  }

  const cap = session.maxPlayers ?? 0;
  const capacityPct = cap > 0 ? Math.min(100, Math.round((activeCount / cap) * 100)) : 0;
  const countdown = fmtCountdown(session.deadline);
  const open = session.signupOpen === true;

  return (
    <section className="glass-card p-4 space-y-3" aria-label="Next session">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="bpm-h3">{fmtDate(session.datetime)}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{session.title ?? 'Session'}</p>
        </div>
        <span
          className="text-xs px-2 py-1 rounded-full"
          style={{
            background: open ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255, 255, 255, 0.06)',
            color: open ? '#86efac' : '#9ca3af',
            border: open ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(255, 255, 255, 0.12)',
          }}
        >
          {open ? 'Signup open' : 'Signup closed'}
        </span>
      </header>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-gray-300">{activeCount} / {cap} signed up</span>
          {waitlistCount > 0 && (
            <span className="text-xs text-gray-400">+{waitlistCount} waitlist</span>
          )}
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255, 255, 255, 0.08)' }}>
          <div
            className="h-full transition-all"
            style={{
              width: `${capacityPct}%`,
              background: capacityPct >= 100 ? '#fca5a5' : capacityPct >= 80 ? '#fcd34d' : '#86efac',
            }}
          />
        </div>
      </div>

      {countdown && (
        <p className="text-xs text-gray-400">
          Deadline: <span className="text-gray-200">{countdown === 'closed' ? 'Passed' : countdown + ' left'}</span>
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {onEdit && (
          <button type="button" onClick={onEdit} className="cc-btn cc-btn-secondary">
            Edit details
          </button>
        )}
        {onEditDateTime && (
          <button type="button" onClick={onEditDateTime} className="cc-btn cc-btn-secondary">
            Date & time
          </button>
        )}
        {onAdvance && (
          <button type="button" onClick={onAdvance} className="cc-btn cc-btn-primary">
            Advance →
          </button>
        )}
      </div>
    </section>
  );
}
