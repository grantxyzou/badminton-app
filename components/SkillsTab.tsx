'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { PlayerSkills as PersistedPlayerSkills } from '@/lib/types';
import type { PlayerSkills } from '@/components/SkillsRadar';
import ShuttleLoader from '@/components/ShuttleLoader';
import StatsPlaceholder from '@/components/stats/StatsPlaceholder';
import AttendanceCardLive from '@/components/stats/cards/AttendanceCardLive';
import StreakSummaryCard from '@/components/stats/StreakSummaryCard';
import SummaryGreeting from '@/components/stats/SummaryGreeting';
import PartnerFrequencyCard from '@/components/stats/cards/PartnerFrequencyCard';
import GameLoggerCard from '@/components/stats/GameLoggerCard';
import RacketRow from '@/components/stats/RacketRow';
import { isFlagOn } from '@/lib/flags';
import { getIdentity, IDENTITY_EVENT } from '@/lib/identity';
import StatsSignedOut from '@/components/stats/StatsSignedOut';

const SkillsRadar = dynamic(() => import('@/components/SkillsRadar'), { ssr: false });
// Recharts needs window → ssr:false, same as SkillsRadar.
const SkillTrendCard = dynamic(() => import('@/components/stats/SkillTrendCard'), { ssr: false });
// Client-only (reads localStorage identity), same posture as SkillTrendCard.
const LevelCard = dynamic(() => import('@/components/stats/LevelCard'), { ssr: false });
const DrillsCard = dynamic(() => import('@/components/stats/DrillsCard'), { ssr: false });
const KudosReceivedCard = dynamic(() => import('@/components/stats/KudosReceivedCard'), { ssr: false });
const GiveKudosCard = dynamic(() => import('@/components/stats/GiveKudosCard'), { ssr: false });

// Hidden for now — admin Add Player + SkillsRadar overlay/compare mode are
// scoped out of the user-facing Stats tab while we figure out whether self-
// tracking is the right product direction. Flip these back to true to bring
// them back; the underlying components still support both features.
const SHOW_ADD_PLAYER_FORM = false;
const SHOW_SKILLS_OVERLAY = false;

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';

// Same identity chain as the stats cards: real identity → stats preview-name.
function resolveActiveName(): string | null {
  const id = getIdentity();
  if (id?.name) return id.name;
  try {
    const stored = localStorage.getItem(STATS_NAME_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    /* ignore */
  }
  return null;
}

function toRadarShape(records: PersistedPlayerSkills[]): PlayerSkills[] {
  return records.map((s) => ({ id: s.id, name: s.name, scores: s.scores }));
}

// Sample profile so the radar always has a shape to draw. Shown ONLY when
// there's no real skill data, and always behind a visible "Sample" badge —
// skill scores have no real source yet (player self-rating is deferred), so
// this is honest demo content, never presented as someone's actual stats.
const SAMPLE_SKILLS: PlayerSkills[] = [
  {
    id: '__sample__',
    name: 'Sample',
    scores: {
      'grip-stroke': 4,
      'movement': 3,
      'serve-return': 4,
      'offense': 3,
      'defense': 2,
      'strategy': 3,
      'knowledge': 4,
    },
  },
];

export default function SkillsTab({ isAdmin, onTabChange }: { isAdmin?: boolean; onTabChange?: (tab: 'home' | 'players' | 'skills' | 'admin' | 'profile') => void }) {
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<PlayerSkills[]>([]);

  // Add-player inline form state
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  // Identity for the assessment spine's signed-out empty state. Subscribes to
  // IDENTITY_EVENT so signing in/out updates the tab without a reload.
  const [activeName, setActiveName] = useState<string | null>(null);
  const [identResolved, setIdentResolved] = useState(false);

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
    // The legacy admin radar is parked under the assessment spine — skip its fetch.
    if (!isAdmin || isFlagOn('NEXT_PUBLIC_FLAG_SKILL_ASSESS')) {
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

  useEffect(() => {
    const update = () => setActiveName(resolveActiveName());
    update();
    setIdentResolved(true);
    window.addEventListener(IDENTITY_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(IDENTITY_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

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
  // Hero slot. When the skill-assessment spine is on, the self-assessment
  // trend hero is the headline; otherwise the legacy streak + AI summary.
  const skillAssessOn = isFlagOn('NEXT_PUBLIC_FLAG_SKILL_ASSESS');
  // Phase 1 canonical level — the private headline read, above the trend radar.
  const levelOn = isFlagOn('NEXT_PUBLIC_FLAG_SKILL_LEVEL');
  // Drills — concrete practice for the lowest-rated skills, below the trend.
  const drillsOn = isFlagOn('NEXT_PUBLIC_FLAG_SKILL_DRILLS');
  // Kudos — positive-only peer recognition (received read here; give in the play slot).
  const kudosOn = isFlagOn('NEXT_PUBLIC_FLAG_KUDOS');
  // Distributed AI insights: a plain-language greeting leads the Summary and the
  // standalone "Your read" card is retired (its synthesis moves into the greeting
  // + per-card chips; the streak still shows on AttendanceCardLive in Game stats).
  const insightCardsOn = isFlagOn('NEXT_PUBLIC_FLAG_INSIGHT_CARDS');
  const heroSlot = skillAssessOn ? (
    <>
      {insightCardsOn && <SummaryGreeting />}
      {levelOn && <LevelCard />}
      <SkillTrendCard />
      {drillsOn && <DrillsCard />}
      {kudosOn && <KudosReceivedCard />}
    </>
  ) : (
    <StreakSummaryCard />
  );

  // Value-Hub Slice-0 splits across the Stats tab's two registers:
  //   • Gear view → RacketRow (your racket + recommendation)
  //   • Game view → game logger (usable any day; decoupled from the session
  //     window/roster) + partner-frequency card
  // All self-contained; flag-gated. Passing gearContent is what turns on the
  // Game/Gear segmented control in StatsPlaceholder.
  const valueHubOn = isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE');
  const showPlay = skillAssessOn || valueHubOn;
  // Gear (racket + recommendation) is parked under the assessment spine.
  const gearContent = !skillAssessOn && valueHubOn ? <RacketRow /> : undefined;
  const gamePlaySlot = showPlay ? (
    <>
      <GameLoggerCard />
      {kudosOn && <GiveKudosCard />}
      <PartnerFrequencyCard />
    </>
  ) : undefined;

  // Skill-assessment spine: two-tab layout. Summary = skill trend; Game stats =
  // AI read (StreakSummaryCard) + attendance + logger + partner. The AI read
  // now folds in the self-assessment trend (see /api/stats/insight). Equipment
  // stays parked.
  if (skillAssessOn) {
    if (!identResolved) return null;
    if (!activeName) {
      return <StatsSignedOut onSignIn={onTabChange ? () => onTabChange('profile') : undefined} />;
    }
    return (
      <StatsPlaceholder
        assessMode
        heroSlot={heroSlot}
        gamePlaySlot={gamePlaySlot}
        attendanceContent={attendanceContent}
        insightSlot={insightCardsOn ? undefined : <StreakSummaryCard />}
      />
    );
  }

  if (!isAdmin) {
    return <StatsPlaceholder attendanceContent={attendanceContent} heroSlot={heroSlot} gamePlaySlot={gamePlaySlot} gearContent={gearContent} />;
  }

  if (loading) {
    return (
      <StatsPlaceholder
        skillProgressionContent={<ShuttleLoader text="Loading skills..." />}
        attendanceContent={attendanceContent}
        heroSlot={heroSlot}
        gamePlaySlot={gamePlaySlot} gearContent={gearContent}
      />
    );
  }

  // Real skill data when present; otherwise a clearly-badged sample so the
  // radar isn't a blank "no graph" hole. (Disclaimer/source line removed.)
  const usingSampleSkills = players.length === 0;
  const radarPlayers = usingSampleSkills ? SAMPLE_SKILLS : players;

  const skillProgressionContent = (
    <div className="space-y-4">
      {usingSampleSkills && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 'var(--radius-pill)',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              border: '1px solid var(--inner-card-border)',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            Sample
          </span>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
            Example profile — self-rating coming soon.
          </p>
        </div>
      )}
      <SkillsRadar players={radarPlayers} onScoresChanged={refresh} showOverlay={SHOW_SKILLS_OVERLAY} />

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
              className="cc-btn cc-btn-primary"
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
      gamePlaySlot={gamePlaySlot} gearContent={gearContent}
    />
  );
}
