'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { PlayerSkills as PersistedPlayerSkills } from '@/lib/types';
import type { PlayerSkills } from '@/components/SkillsRadar';
import ShuttleLoader from '@/components/ShuttleLoader';

const SkillsRadar = dynamic(() => import('@/components/SkillsRadar'), { ssr: false });

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function toRadarShape(records: PersistedPlayerSkills[]): PlayerSkills[] {
  return records.map((s) => ({ id: s.id, name: s.name, scores: s.scores }));
}

export default function SkillsTab({ isAdmin }: { isAdmin?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<PlayerSkills[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/skills`, { cache: 'no-store' });
      if (!res.ok) return;
      const data: { skills: PersistedPlayerSkills[] } = await res.json();
      setPlayers(toRadarShape(data.skills ?? []));
    } catch {
      /* swallow — empty state will show */
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, refresh]);

  async function handleAddPlayer() {
    const name = window.prompt('Player name:')?.trim();
    if (!name) return;
    try {
      const res = await fetch(`${BASE}/api/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, scores: {} }),
      });
      if (res.ok) await refresh();
    } catch {
      /* ignore — refresh stays as-is */
    }
  }

  if (!isAdmin) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ minHeight: 'calc(100vh - 12rem)' }}
      >
        <p className="text-2xl font-semibold text-center" style={{ color: 'var(--text-muted)' }}>
          Progress together?
        </p>
      </div>
    );
  }

  if (loading) {
    return <ShuttleLoader text="Loading skills..." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleAddPlayer}
          className="text-xs font-medium px-3 py-1.5 rounded-md"
          style={{ color: 'var(--accent)', background: 'var(--inner-card-bg)', minHeight: 36 }}
        >
          + Add player
        </button>
      </div>
      {players.length === 0 ? (
        <div
          className="flex items-center justify-center"
          style={{ minHeight: 'calc(100vh - 16rem)' }}
        >
          <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
            No skill profiles yet. Tap <span style={{ color: 'var(--accent)' }}>+ Add player</span> to create one.
          </p>
        </div>
      ) : (
        <SkillsRadar players={players} onScoresChanged={refresh} />
      )}
    </div>
  );
}
