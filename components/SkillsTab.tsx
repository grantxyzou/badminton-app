'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
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
  const pageT = useTranslations('pages.learn');
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<PlayerSkills[]>([]);

  // Add-player inline form state
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

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

  async function handleAddPlayer(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setAddError('Enter a player name');
      return;
    }
    setAdding(true);
    setAddError('');
    try {
      const res = await fetch(`${BASE}/api/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, scores: {} }),
      });
      if (res.ok) {
        setName('');
        await refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setAddError(data.error ?? `Failed to add player (${res.status})`);
      }
    } catch {
      setAddError('Network error. Please try again.');
    } finally {
      setAdding(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
          {pageT('title')}
        </h1>
        <div
          className="flex items-center justify-center"
          style={{ minHeight: 'calc(100vh - 16rem)' }}
        >
          <p className="text-2xl font-semibold text-center" style={{ color: 'var(--text-muted)' }}>
            Progress together?
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
          {pageT('title')}
        </h1>
        <ShuttleLoader text="Loading skills..." />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
        {pageT('title')}
      </h1>
      <div className="space-y-4">
      {players.length === 0 ? (
        <div
          className="flex items-center justify-center"
          style={{ minHeight: '20vh' }}
        >
          <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
            No skill profiles yet. Add a player below to create one.
          </p>
        </div>
      ) : (
        <SkillsRadar players={players} onScoresChanged={refresh} />
      )}

      {/* Add player form — placed at the bottom so its submit button is
          in the thumb zone for one-handed use. */}
      <form onSubmit={handleAddPlayer} className="glass-card p-5 space-y-3">
        <h3 className="section-label">ADD PLAYER</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Player name"
            aria-label="Player name"
            aria-describedby={addError ? 'skills-add-error' : undefined}
            value={name}
            onChange={(e) => { setName(e.target.value); setAddError(''); }}
            maxLength={50}
            className="flex-1"
          />
          <button
            type="submit"
            disabled={adding || !name.trim()}
            className="btn-primary"
            style={{ whiteSpace: 'nowrap', minHeight: 44 }}
          >
            {adding ? '…' : 'Add'}
          </button>
        </div>
        {addError && (
          <p id="skills-add-error" role="alert" className="text-red-400 text-xs">
            {addError}
          </p>
        )}
      </form>
      </div>
    </div>
  );
}
