'use client';

import { useState, useCallback } from 'react';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import { SKILL_DIMENSIONS, SKILL_LEVELS } from '@/lib/skills-data';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';

/* ── Types ── */
export interface PlayerSkills {
  id: string;
  name: string;
  scores: Record<string, number>;
}

interface SheetState {
  type: 'detail' | 'edit';
  dimId: string;
}

/* ── Player colors for overlay mode ── */
const PLAYER_COLORS = [
  '#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa',
  '#34d399', '#fb923c', '#e879f9',
];

/* ── Short labels for radar axes ── */
const SHORT_LABELS: Record<string, string> = {
  'grip-stroke': 'Grip',
  'movement': 'Movement',
  'serve-return': 'Serve',
  'offense': 'Offense',
  'defense': 'Defense',
  'strategy': 'Strategy',
  'knowledge': 'Knowledge',
};

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/* ══════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════ */

export default function SkillsRadar({
  players,
  onScoresChanged,
}: {
  players: PlayerSkills[];
  onScoresChanged?: () => void;
}) {
  const [mode, setMode] = useState<'solo' | 'overlay'>('solo');
  const [activePlayerId, setActivePlayerId] = useState(players[0]?.id ?? '');
  const [overlayIds, setOverlayIds] = useState<Set<string>>(new Set([players[0]?.id ?? '']));
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [localScores, setLocalScores] = useState<Record<string, Record<string, number>>>(() => {
    const map: Record<string, Record<string, number>> = {};
    players.forEach(p => { map[p.id] = { ...p.scores }; });
    return map;
  });

  const activePlayer = players.find(p => p.id === activePlayerId);
  const activeScores = localScores[activePlayerId] ?? {};

  /* ── Radar chart data ── */
  const chartData = SKILL_DIMENSIONS.map(dim => {
    const entry: Record<string, string | number> = {
      category: SHORT_LABELS[dim.id] ?? dim.name,
      fullName: dim.name,
      dimId: dim.id,
    };
    if (mode === 'solo') {
      entry.score = activeScores[dim.id] ?? 0;
    } else {
      overlayIds.forEach(id => {
        entry[id] = localScores[id]?.[dim.id] ?? 0;
      });
    }
    return entry;
  });

  /* ── Overlay toggle ── */
  const toggleOverlay = (id: string) => {
    setOverlayIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /* ── Edit handler: optimistic local update + background PATCH ── */
  const handleScoreChange = (dimId: string, level: number) => {
    const nextPlayerScores = { ...localScores[activePlayerId], [dimId]: level };
    setLocalScores(prev => ({ ...prev, [activePlayerId]: nextPlayerScores }));
    // Fire-and-forget PATCH. If it fails the parent's next refresh will reconcile.
    fetch(`${BASE}/api/skills`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activePlayerId, scores: { [dimId]: level } }),
    })
      .then((r) => {
        if (r.ok) onScoresChanged?.();
      })
      .catch(() => { /* stale local state is fine; refresh will recover */ });
  };

  const openSheet = useCallback((dimId: string, type: 'detail' | 'edit') => {
    setSheet({ type, dimId });
  }, []);

  return (
    <div className="space-y-4 pb-4">
      {/* Solo / Overlay toggle */}
      <div className="flex justify-center">
        <div className="segment-control flex" style={{ width: 200 }}>
          {(['solo', 'overlay'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 flex items-center justify-center text-xs capitalize transition-all ${
                mode === m ? 'segment-tab-active' : 'segment-tab-inactive'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Player pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {players.map((p, i) => {
          const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
          const isActive = mode === 'solo'
            ? p.id === activePlayerId
            : overlayIds.has(p.id);

          return (
            <button
              key={p.id}
              onClick={() => {
                if (mode === 'solo') setActivePlayerId(p.id);
                else toggleOverlay(p.id);
              }}
              className="shrink-0 flex items-center gap-2 px-3 rounded-full transition-all"
              style={{
                height: 44,
                background: isActive
                  ? `linear-gradient(160deg, ${color}20 0%, ${color}08 100%)`
                  : 'var(--inner-card-bg)',
                border: `1.5px solid ${isActive ? `${color}60` : 'var(--inner-card-border)'}`,
              }}
            >
              <span
                className="rounded-full shrink-0"
                style={{ width: 8, height: 8, background: color }}
              />
              <span
                className="text-sm font-medium whitespace-nowrap"
                style={{ color: isActive ? color : 'var(--text-secondary)' }}
              >
                {p.name}
              </span>
            </button>
          );
        })}
      </div>

      {/* Radar chart */}
      <div className="glass-card p-3">
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="75%">
            <PolarGrid
              stroke="var(--glass-border)"
              strokeDasharray="3 3"
            />
            <PolarAngleAxis
              dataKey="category"
              tick={{ fill: 'var(--text-secondary)', fontSize: 11, fontWeight: 500 }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 6]}
              tickCount={7}
              tick={{ fill: 'var(--text-muted)', fontSize: 9 }}
              axisLine={false}
            />
            {mode === 'solo' ? (
              <Radar
                name={activePlayer?.name ?? ''}
                dataKey="score"
                stroke="#4ade80"
                fill="#4ade80"
                fillOpacity={0.15}
                strokeWidth={2}
                dot={{ r: 4, fill: '#4ade80', strokeWidth: 0 }}
              />
            ) : (
              Array.from(overlayIds).map((id, i) => {
                const player = players.find(p => p.id === id);
                const idx = players.findIndex(p => p.id === id);
                const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
                return (
                  <Radar
                    key={id}
                    name={player?.name ?? ''}
                    dataKey={id}
                    stroke={color}
                    fill={color}
                    fillOpacity={0.08}
                    strokeWidth={2}
                    dot={{ r: 3, fill: color, strokeWidth: 0 }}
                  />
                );
              })
            )}
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Helper text */}
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Tap a category to see your ACE level description
      </p>

      {/* Category cards — 2 column grid */}
      <div className="grid grid-cols-2 gap-3">
        {SKILL_DIMENSIONS.map(dim => {
          const score = activeScores[dim.id] ?? 0;
          const levelName = SKILL_LEVELS.find(l => l.level === score)?.name ?? '—';
          return (
            <button
              key={dim.id}
              onClick={() => openSheet(dim.id, 'detail')}
              className="glass-card p-3 text-left transition-all active:scale-[0.97]"
              style={{ minHeight: 44 }}
            >
              <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                {dim.name}
              </p>
              <p className="text-sm font-bold mt-1" style={{ color: 'var(--text-primary)' }}>
                {score > 0 ? `${score} — ${levelName}` : 'Not rated'}
              </p>
            </button>
          );
        })}
      </div>

      {/* Bottom sheet */}
      {sheet && (
        <SkillDetailSheet
          dimId={sheet.dimId}
          type={sheet.type}
          playerName={activePlayer?.name ?? ''}
          score={activeScores[sheet.dimId] ?? 0}
          onScoreChange={(level) => handleScoreChange(sheet.dimId, level)}
          onClose={() => setSheet(null)}
          onSwitchToEdit={() => setSheet(s => s ? { ...s, type: 'edit' } : null)}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   Bottom Sheet
   ══════════════════════════════════════════ */

interface SkillDetailSheetProps {
  dimId: string;
  type: 'detail' | 'edit';
  playerName: string;
  score: number;
  onScoreChange: (level: number) => void;
  onClose: () => void;
  onSwitchToEdit: () => void;
}

function SkillDetailSheet({ dimId, type, playerName, score, onScoreChange, onClose, onSwitchToEdit }: SkillDetailSheetProps) {
  const dim = SKILL_DIMENSIONS.find(d => d.id === dimId);
  if (!dim) return null;

  const levelName = SKILL_LEVELS.find(l => l.level === score)?.name ?? '—';

  // Inline glass styling (preserved from original). Applied to a wrapper inside
  // the primitive so the visual appearance is unchanged. The flex props let
  // the wrapper participate in the BottomSheet's flex column layout, so the
  // BottomSheetBody inside can flex-1 + scroll when content overflows
  // (e.g., the EditContent score list when the sheet is short).
  const glassStyle: React.CSSProperties = {
    background: 'var(--glass-bg)',
    WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(140%)',
    backdropFilter: 'blur(var(--glass-blur)) saturate(140%)',
    border: '1px solid var(--glass-border)',
    borderBottom: 'none',
    boxShadow: 'var(--glass-shadow)',
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minHeight: 0,
  };

  return (
    <BottomSheet
      open={true}
      onClose={onClose}
      ariaLabel={`${dim.name} for ${playerName}`}
      maxHeight="calc(100vh - 60px)"
      className="max-w-lg mx-auto"
    >
      <div style={glassStyle}>
        {/* Header */}
        <BottomSheetHeader className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {dim.name}
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-full"
            style={{
              width: 32,
              height: 32,
              background: 'var(--inner-card-bg)',
              border: '1px solid var(--inner-card-border)',
            }}
          >
            <span className="material-icons" style={{ fontSize: 18, color: 'var(--text-muted)' }}>
              close
            </span>
          </button>
        </BottomSheetHeader>

        {/* Content — overscroll-behavior: contain prevents the sheet's
            inner scroll from chaining to the body when it hits its edge.
            WebkitOverflowScrolling: touch gives iOS momentum scroll, which
            is important when the content is long (e.g., 6 ACE levels each
            with a paragraph of description). */}
        <BottomSheetBody
          className="px-5 pb-8"
          style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
        >
          {type === 'detail' ? (
            <DetailContent
              dim={dim}
              playerName={playerName}
              score={score}
              levelName={levelName}
              onEdit={onSwitchToEdit}
            />
          ) : (
            <EditContent
              dim={dim}
              score={score}
              onScoreChange={onScoreChange}
            />
          )}
        </BottomSheetBody>
      </div>
    </BottomSheet>
  );
}

/* ── Detail view inside bottom sheet ── */
function DetailContent({
  dim, playerName, score, levelName, onEdit,
}: {
  dim: typeof SKILL_DIMENSIONS[number];
  playerName: string;
  score: number;
  levelName: string;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Player's current level */}
      {score > 0 && (
        <div
          className="p-4 rounded-xl"
          style={{
            background: 'var(--inner-card-green-bg)',
            border: '1px solid var(--inner-card-green-border)',
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {playerName}
            </span>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: 'rgba(74, 222, 128, 0.2)',
                color: 'var(--text-primary)',
              }}
            >
              {score} — {levelName}
            </span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {dim.levels[score]}
          </p>
        </div>
      )}

      {/* Edit button */}
      <button
        onClick={onEdit}
        className="btn-ghost w-full flex items-center justify-center gap-2 px-4 rounded-xl"
        style={{ height: 44 }}
      >
        <span className="material-icons" style={{ fontSize: 16 }}>edit</span>
        <span className="text-sm font-medium">Edit level</span>
      </button>

      {/* All levels */}
      <div
        className="p-4 rounded-xl space-y-3"
        style={{
          background: 'var(--inner-card-bg)',
          border: '1px solid var(--inner-card-border)',
        }}
      >
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          All Levels
        </p>
        {SKILL_LEVELS.map(l => {
          const isActive = l.level === score;
          return (
            <div key={l.level} className="flex gap-3">
              <span
                className="text-sm font-bold shrink-0 mt-0.5"
                style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', width: 14 }}
              >
                {l.level}
              </span>
              <div className="min-w-0">
                <span
                  className="text-sm font-semibold"
                  style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                >
                  {l.name} —{' '}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {dim.levels[l.level]?.slice(0, 80)}...
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Edit view inside bottom sheet ── */
function EditContent({
  dim, score, onScoreChange,
}: {
  dim: typeof SKILL_DIMENSIONS[number];
  score: number;
  onScoreChange: (level: number) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Tap a level to set your rating for {dim.name}
      </p>

      {/* 6 large tap buttons */}
      {SKILL_LEVELS.map(l => {
        const isActive = l.level === score;
        return (
          <button
            key={l.level}
            onClick={() => onScoreChange(l.level)}
            className="w-full text-left p-4 rounded-xl transition-all active:scale-[0.98]"
            style={{
              minHeight: 44,
              background: isActive ? 'var(--inner-card-green-bg)' : 'var(--inner-card-bg)',
              border: `1.5px solid ${isActive ? 'var(--inner-card-green-border)' : 'var(--inner-card-border)'}`,
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-sm font-bold"
                style={{ color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}
              >
                {l.level}. {l.name}
              </span>
              {isActive && (
                <span className="material-icons" style={{ fontSize: 16, color: 'var(--accent)' }}>
                  check_circle
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {dim.levels[l.level]}
            </p>
          </button>
        );
      })}
    </div>
  );
}
