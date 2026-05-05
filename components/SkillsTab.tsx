'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import type { PlayerSkills as PersistedPlayerSkills } from '@/lib/types';
import type { PlayerSkills } from '@/components/SkillsRadar';
import ShuttleLoader from '@/components/ShuttleLoader';
import StatsPlaceholder from '@/components/stats/StatsPlaceholder';
import AttendanceCardLive from '@/components/stats/cards/AttendanceCardLive';
import StatsStreakHero from '@/components/stats/StatsStreakHero';
import WeeklySummaryCard from '@/components/stats/WeeklySummaryCard';

const SkillsRadar = dynamic(() => import('@/components/SkillsRadar'), { ssr: false });

// Hidden for now — admin Add Player + SkillsRadar overlay/compare mode are
// scoped out of the user-facing Stats tab while we figure out whether self-
// tracking is the right product direction. Flip these back to true to bring
// them back; the underlying components still support both features.
const SHOW_ADD_PLAYER_FORM = false;
const SHOW_SKILLS_OVERLAY = false;

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

function toRadarShape(records: PersistedPlayerSkills[]): PlayerSkills[] {
  return records.map((s) => ({ id: s.id, name: s.name, scores: s.scores }));
}

export default function SkillsTab({ isAdmin, onTabChange }: { isAdmin?: boolean; onTabChange?: (tab: 'home' | 'players' | 'skills' | 'admin' | 'profile') => void }) {
  const tStats = useTranslations('stats');
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

  // Live attendance + streak hero are now always-on (flag retired post-v1.3).
  const attendanceContent = <AttendanceCardLive />;
  // Hero slot stacks the streak then the weekly AI summary card so both sit
  // above the heatmap. WeeklySummaryCard self-hides when no active name.
  const heroSlot = (
    <>
      <StatsStreakHero />
      <WeeklySummaryCard />
    </>
  );

  if (!isAdmin) {
    return <StatsPlaceholder attendanceContent={attendanceContent} heroSlot={heroSlot} />;
  }

  if (loading) {
    return (
      <StatsPlaceholder
        skillProgressionContent={<ShuttleLoader text="Loading skills..." />}
        attendanceContent={attendanceContent}
        heroSlot={heroSlot}
      />
    );
  }

  const skillProgressionContent = (
    <div className="space-y-4">
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.45 }}>
        {tStats.rich('progression.disclaimer', {
          link: (chunks) => (
            <a
              href="https://www.acesports.ca/skills-matrix"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent)', textDecoration: 'underline' }}
            >
              {chunks}
            </a>
          ),
        })}
      </p>
      {players.length === 0 ? (
        <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>
          No skill profiles yet.
        </p>
      ) : (
        <SkillsRadar players={players} onScoresChanged={refresh} showOverlay={SHOW_SKILLS_OVERLAY} />
      )}

      {SHOW_ADD_PLAYER_FORM && (
        <form onSubmit={handleAddPlayer} className="glass-card-soft p-3 space-y-2">
          <p className="section-label">ADD PLAYER</p>
          <div className="flex gap-2">
            <input
              id="skills-player-name"
              name="playerName"
              type="text"
              placeholder="Player name"
              aria-label="Player name"
              aria-describedby={addError ? 'skills-add-error' : undefined}
              value={name}
              onChange={(e) => { setName(e.target.value); setAddError(''); }}
              maxLength={50}
              autoComplete="off"
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
      )}
    </div>
  );

  return (
    <StatsPlaceholder
      skillProgressionContent={skillProgressionContent}
      attendanceContent={attendanceContent}
      heroSlot={heroSlot}
    />
  );
}
