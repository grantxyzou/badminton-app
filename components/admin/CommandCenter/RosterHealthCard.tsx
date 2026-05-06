'use client';

import { useEffect, useState, useCallback } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface SessionLite {
  approvedNames?: string[];
  maxPlayers?: number;
}

interface PlayerLite {
  removed?: boolean;
  waitlisted?: boolean;
  removedAt?: string;
  cancelledBySelf?: boolean;
}

interface RosterHealth {
  inviteListSize: number;
  waitlistCount: number;
  recentRemovals: number;
}

interface RosterHealthCardProps {
  onOpen?: () => void;
}

export default function RosterHealthCard({ onOpen }: RosterHealthCardProps = {}) {
  const [health, setHealth] = useState<RosterHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionRes, playersRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        // Include removed records so we can count recent removals.
        fetch(`${BASE}/api/players?all=true`, { cache: 'no-store' }),
      ]);
      const session = sessionRes.ok ? ((await sessionRes.json()) as SessionLite) : null;
      const players = playersRes.ok ? ((await playersRes.json()) as PlayerLite[]) : [];

      const inviteListSize = Array.isArray(session?.approvedNames) ? session!.approvedNames!.length : 0;
      const waitlistCount = players.filter((p) => !p.removed && p.waitlisted).length;
      // Recent removals = removed in the last 7 days for this session.
      const sevenDaysAgo = Date.now() - 7 * 86_400_000;
      const recentRemovals = players.filter((p) => {
        if (!p.removed) return false;
        if (!p.removedAt) return true; // legacy without timestamp — count anyway
        const t = new Date(p.removedAt).getTime();
        return Number.isFinite(t) && t >= sevenDaysAgo;
      }).length;

      setHealth({ inviteListSize, waitlistCount, recentRemovals });
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return null;
  if (!health) {
    return (
      <section className="glass-card p-4 space-y-1 opacity-60" aria-label="Roster health">
        <h3 className="bpm-h3">Roster health</h3>
        <p className="text-xs text-gray-400">No data.</p>
      </section>
    );
  }

  return (
    <section className="glass-card p-4 space-y-3" aria-label="Roster health">
      <h3 className="bpm-h3">Roster health</h3>
      <div className="grid grid-cols-3 gap-3">
        <RosterStat label="Invite list" value={health.inviteListSize} />
        <RosterStat label="Waitlist" value={health.waitlistCount} />
        <RosterStat
          label="Removed (7d)"
          value={health.recentRemovals}
          tone={health.recentRemovals >= 3 ? 'warning' : 'neutral'}
        />
      </div>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="text-xs text-gray-300 hover:text-gray-100 underline-offset-2 hover:underline"
        >
          Manage roster →
        </button>
      )}
    </section>
  );
}

function RosterStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'rgba(255, 255, 255, 0.04)' }}>
      <p className="bpm-h2" style={{ color: tone === 'warning' ? '#fcd34d' : 'inherit' }}>
        {value}
      </p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}
