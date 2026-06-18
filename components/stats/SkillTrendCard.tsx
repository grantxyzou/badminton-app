'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} from 'recharts';
import { getIdentity } from '@/lib/identity';
import { SKILLS, topStrengths, workOnNext, type Rating, type Dimension, type Phase } from '@/lib/assessment';
import { isFlagOn } from '@/lib/flags';
import { useInsight } from '@/lib/useInsight';
import InsightChip from '@/components/stats/InsightChip';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import CheckInSheet from './CheckInSheet';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import CardHeader from '@/components/primitives/CardHeader';
import StatusBadge from '@/components/primitives/StatusBadge';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const STATS_NAME_KEY = 'badminton_stats_preview_name';

/** Same identity chain as the other stats cards: real identity → stats
 *  preview-name → null. Real identity wins so trends key to the real player. */
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

/** A persisted assessment snapshot (mirrors the /api/assessments doc). */
interface Snapshot {
  id: string;
  takenAt: string;
  ratings: Rating[];
  overall: number | null;
  dimensionScores: Record<Dimension, number | null>;
  phase: Phase | null;
}

/** Short axis labels for the 14-skill radar (full labels live on the cards). */
const SHORT: Record<string, string> = {
  serves_returns: 'Serve',
  net_play: 'Net',
  clears_lifts: 'Clear',
  drops: 'Drop',
  drives: 'Drive',
  smashes: 'Smash',
  grip_deception: 'Grip',
  footwork_split_step: 'Footwork',
  court_coverage: 'Court',
  speed_stamina: 'Stamina',
  game_reading: 'Reading',
  consistency: 'Consist.',
  rules_strategy: 'Rules',
  training_mindset: 'Mindset',
};

const SKILL_BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));
const DIMENSIONS: Dimension[] = ['technical', 'physical', 'mental'];

const NOW_COLOR = '#4ade80';
const THEN_COLOR = '#94a3b8';

function ratingMap(snap: Snapshot | undefined): Map<string, number> {
  return new Map((snap?.ratings ?? []).map((r) => [r.skillKey, r.value]));
}

function fmt(n: number | null): string {
  return n === null ? '—' : n.toFixed(1);
}

function Delta({ value }: { value: number }) {
  if (Math.abs(value) < 0.05) return null;
  const up = value > 0;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: up ? 'var(--accent, #22c55e)' : 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(value % 1 === 0 ? 0 : 1)}
    </span>
  );
}

function RadarBlock({
  data, hasThen, nowColor, thenColor, height = 300, fontSize = 10, thenLabel, nowLabel,
}: {
  data: { category: string; now: number; then: number }[];
  hasThen: boolean;
  // Resolved at runtime from --accent / --text-muted so the chart honors the
  // theme (recharts sets stroke/fill as SVG attributes, where var() can't resolve).
  nowColor: string;
  thenColor: string;
  height?: number;
  fontSize?: number;
  thenLabel: string;
  nowLabel: string;
}) {
  return (
    <div style={{ margin: '0 -8px' }} aria-hidden="true">
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="72%">
          <PolarGrid stroke="var(--glass-border)" strokeDasharray="3 3" />
          <PolarAngleAxis dataKey="category" tick={{ fill: 'var(--text-secondary)', fontSize, fontWeight: 500 }} />
          <PolarRadiusAxis angle={90} domain={[0, 5]} tickCount={6} tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} />
          {hasThen && (
            <Radar name={thenLabel} dataKey="then" stroke={thenColor} fill={thenColor} fillOpacity={0.06} strokeWidth={1.5} strokeDasharray="4 3" />
          )}
          <Radar name={nowLabel} dataKey="now" stroke={nowColor} fill={nowColor} fillOpacity={0.18} strokeWidth={2} dot={{ r: 3, fill: nowColor, strokeWidth: 0 }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function SkillTrendCard() {
  const t = useTranslations('stats');
  const [activeName, setActiveName] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [sheetSkill, setSheetSkill] = useState<string | null>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  // Distributed AI insight — a short, non-obvious chip about the skill trend.
  const insightsOn = isFlagOn('NEXT_PUBLIC_FLAG_INSIGHT_CARDS');
  const { data: insight } = useInsight(insightsOn);

  useEffect(() => {
    setActiveName(resolveActiveName());
  }, []);

  const load = useCallback(() => {
    if (!activeName) return;
    fetch(`${BASE}/api/assessments?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        setSnapshots((d.assessments ?? []) as Snapshot[]);
        setLoaded(true);
        setLoadError(false);
      })
      .catch(() => { setLoadError(true); setLoaded(true); });
  }, [activeName]);

  useEffect(() => { load(); }, [load]);

  const latest = snapshots[snapshots.length - 1];
  const prev = snapshots.length > 1 ? snapshots[snapshots.length - 2] : undefined;

  const chartData = useMemo(() => {
    const now = ratingMap(latest);
    const then = ratingMap(prev);
    return SKILLS.map((s) => ({
      category: SHORT[s.key] ?? s.label,
      now: now.get(s.key) ?? 0,
      then: then.get(s.key) ?? 0,
    }));
  }, [latest, prev]);

  const [showAll, setShowAll] = useState(false);

  // Resolve radar stroke/fill from the theme tokens (recharts can't read
  // var() in SVG attributes). Re-read when the theme flips so the chart
  // stays on-system in both light and dark.
  const [radarColors, setRadarColors] = useState({ now: NOW_COLOR, then: THEN_COLOR });
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      setRadarColors({
        now: cs.getPropertyValue('--accent').trim() || NOW_COLOR,
        then: cs.getPropertyValue('--text-muted').trim() || THEN_COLOR,
      });
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  if (!activeName) return null;

  if (loadError) {
    return (
      <div className="glass-card p-5">
        <ErrorState message={t('assess.error')} />
      </div>
    );
  }

  if (!loaded) return null;

  // Card chrome wraps every state so the section reads consistently.
  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className="glass-card p-5 space-y-3">
      <CardHeader
        icon="trending_up"
        title={t('assess.heroTitle')}
        subtitle={latest ? t('assess.purpose') : undefined}
        action={latest ? (
          <button type="button" onClick={() => setCheckInOpen(true)} className="cc-btn cc-btn-secondary" style={{ whiteSpace: 'nowrap' }}>
            {t('assess.reRate')}
          </button>
        ) : undefined}
      />
      {children}
    </div>
  );

  // Empty — no check-in yet.
  if (!latest) {
    return (
      <>
        <Frame>
          <EmptyState>{t('assess.empty')}</EmptyState>
          <button type="button" onClick={() => setCheckInOpen(true)} className="cc-btn cc-btn-primary cc-btn-lg" style={{ width: '100%' }}>
            {t('assess.rateSkills')}
          </button>
        </Frame>
        <CheckInSheet name={activeName} open={checkInOpen} onClose={() => setCheckInOpen(false)} onSaved={load} />
      </>
    );
  }

  const nowMap = ratingMap(latest);
  const thenMap = ratingMap(prev);
  const strengths = topStrengths(latest.ratings);
  const workOn = workOnNext(latest.ratings);

  return (
    <Frame>
      {/* Phase headline + overall */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        {latest.phase && (
          <StatusBadge variant="phase" tone={latest.phase === 'switch' ? 'amber' : 'accent'}>
            {t(`assess.phase.${latest.phase}`)}
          </StatusBadge>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('assess.overall')}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
            {fmt(latest.overall)}
          </span>
          {prev && latest.overall !== null && prev.overall !== null && (
            <Delta value={latest.overall - prev.overall} />
          )}
        </div>
      </div>

      {/* The Switch callout — the key narrative moment (spec §6). */}
      {latest.phase === 'switch' && (
        <p style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)', margin: 0 }}>
          {t('assess.switchCallout')}
        </p>
      )}

      {/* Radar (decorative, aria-hidden): the 14-skill now-vs-then overlay.
          The accessible truth is the sr-only summary + dimension tiles + the
          skill list below. */}
      <RadarBlock data={chartData} hasThen={!!prev} nowColor={radarColors.now} thenColor={radarColors.then} thenLabel={t('assess.then')} nowLabel={t('assess.now')} />
      <p className="sr-only">
        {t('assess.overall')} {fmt(latest.overall)}
        {latest.phase ? `, ${t(`assess.phase.${latest.phase}`)}` : ''}.
      </p>

      {/* Legend (only meaningful with a prior snapshot) */}
      {prev ? (
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 0, borderTop: `2px dashed ${radarColors.then}` }} /> {t('assess.then')}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 0, borderTop: `2px solid ${radarColors.now}` }} /> {t('assess.now')}
          </span>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>{t('assess.baseline')}</p>
      )}

      {/* Dimension scores with deltas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {DIMENSIONS.map((dim) => {
          const nowV = latest.dimensionScores?.[dim] ?? null;
          const thenV = prev?.dimensionScores?.[dim] ?? null;
          return (
            <div key={dim} className="cc-tile cc-tile-static" style={{ padding: 10, textAlign: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t(`assess.dim.${dim}`)}
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4, marginTop: 2 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(nowV)}</span>
                {nowV !== null && thenV !== null && <Delta value={nowV - thenV} />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Strengths + work-on (tap to read the anchor you picked) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
        <SkillList title={t('assess.strengths')} items={strengths} nowMap={nowMap} thenMap={thenMap} onPick={setSheetSkill} />
        <SkillList title={t('assess.workOn')} items={workOn} nowMap={nowMap} thenMap={thenMap} onPick={setSheetSkill} />
      </div>

      {insightsOn && insight?.trend && <InsightChip {...insight.trend} />}

      {/* Full per-skill profile (spec §7.2/§7.5) — collapsible; also the
          accessible representation of the aria-hidden radar. */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="cc-btn cc-btn-ghost"
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {showAll ? t('assess.hideSkills') : t('assess.allSkills')}
        </button>
        {showAll && (
          <div className="space-y-3">
            {DIMENSIONS.map((dim) => {
              const dimItems = SKILLS.filter((s) => s.dimension === dim && nowMap.has(s.key)).map(
                (s) => ({ skillKey: s.key, value: nowMap.get(s.key)! }),
              );
              return (
                <SkillList key={dim} title={t(`assess.dim.${dim}`)} items={dimItems} nowMap={nowMap} thenMap={thenMap} onPick={setSheetSkill} />
              );
            })}
          </div>
        )}
      </div>

      {sheetSkill && (
        <SkillAnchorSheet skillKey={sheetSkill} value={nowMap.get(sheetSkill) ?? 0} onClose={() => setSheetSkill(null)} />
      )}

      <CheckInSheet name={activeName} open={checkInOpen} onClose={() => setCheckInOpen(false)} onSaved={load} previous={nowMap} />
    </Frame>
  );
}

function SkillList({
  title, items, nowMap, thenMap, onPick,
}: {
  title: string;
  items: Rating[];
  nowMap: Map<string, number>;
  thenMap: Map<string, number>;
  onPick: (key: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="section-label" style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-muted)', margin: 0 }}>{title}</p>
      {items.map((r) => {
        const skill = SKILL_BY_KEY.get(r.skillKey);
        if (!skill) return null;
        const thenV = thenMap.get(r.skillKey);
        const nowV = nowMap.get(r.skillKey) ?? r.value;
        return (
          <button
            key={r.skillKey}
            type="button"
            onClick={() => onPick(r.skillKey)}
            className="cc-mini-card"
            style={{ width: '100%', padding: 10, textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer' }}
          >
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.2 }}>{skill.label}</span>
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{nowV}</span>
              {thenV !== undefined && <Delta value={nowV - thenV} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SkillAnchorSheet({ skillKey, value, onClose }: { skillKey: string; value: number; onClose: () => void }) {
  const skill = SKILL_BY_KEY.get(skillKey);
  if (!skill) return null;
  return (
    <BottomSheet open onClose={onClose} ariaLabel={skill.label} maxHeight="75vh" className="max-w-lg mx-auto">
      <div
        style={{
          background: 'var(--glass-bg)',
          WebkitBackdropFilter: 'blur(var(--glass-blur)) saturate(140%)',
          backdropFilter: 'blur(var(--glass-blur)) saturate(140%)',
          border: '1px solid var(--glass-border)',
          borderBottom: 'none',
          boxShadow: 'var(--glass-shadow)',
          display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0,
        }}
      >
        <BottomSheetHeader className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{skill.label}</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-full"
            style={{ width: 32, height: 32, background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)' }}
          >
            <span className="material-icons" style={{ fontSize: 18, color: 'var(--text-muted)' }}>close</span>
          </button>
        </BottomSheetHeader>
        <BottomSheetBody className="px-5 pb-8" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
          <div className="space-y-2">
            {skill.anchors.map((anchor, i) => {
              const level = i + 1;
              const isActive = level === value;
              return (
                <div
                  key={level}
                  className="p-3 rounded-xl"
                  style={{
                    background: isActive ? 'var(--inner-card-green-bg)' : 'var(--inner-card-bg)',
                    border: `1.5px solid ${isActive ? 'var(--inner-card-green-border)' : 'var(--inner-card-border)'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: isActive ? 'var(--accent, #22c55e)' : 'var(--text-muted)' }}>{level}</span>
                    {isActive && (
                      <span className="material-icons" style={{ fontSize: 15, color: 'var(--accent, #22c55e)' }}>check_circle</span>
                    )}
                  </div>
                  <p style={{ fontSize: 13, lineHeight: 1.45, color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', margin: 0 }}>{anchor}</p>
                </div>
              );
            })}
          </div>
        </BottomSheetBody>
      </div>
    </BottomSheet>
  );
}
