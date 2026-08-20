'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity } from '@/lib/identity';
import DimensionBars from './DimensionBars';
import { SKILLS, topStrengths, workOnNext, type Rating, type Dimension, type Phase } from '@/lib/assessment';
import { isFlagOn } from '@/lib/flags';
import { useInsight } from '@/lib/useInsight';
import InsightChip from '@/components/stats/InsightChip';
import StatCard, { type StatTone } from '@/components/stats/StatCard';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import CheckInSheet from './CheckInSheet';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import CardHeader from '@/components/primitives/CardHeader';
import ListRow from '@/components/primitives/ListRow';

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

/** Response shape of GET /api/stats/club/bands. */
interface ClubBands {
  cohort: number;
  minCohort: number;
  dimensionMedians: Partial<Record<Dimension, number | null>>;
  skills: { skillKey: string; band: 'top' | 'middle' | 'bottom' }[];
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

const SKILL_BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));
const DIMENSIONS: Dimension[] = ['technical', 'physical', 'mental'];
// Dimension → gradient tone for the Technical / Physical / Mental tiles.
const DIM_TONE: Record<Dimension, StatTone> = { technical: 'blue', physical: 'accent', mental: 'amber' };

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
        fontSize: 'var(--fs-xs)',
        fontWeight: 600,
        color: up ? 'var(--accent, #22c55e)' : 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(value % 1 === 0 ? 0 : 1)}
    </span>
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

  const [showAll, setShowAll] = useState(false);

  // Club medians for the bar ticks. This read is deliberately allowed to fail
  // quietly: the comparison is an enhancement, and a member's own dimension
  // scores must render whether or not the club context is available. `null`
  // means "no ticks", which looks like plain bars — not like a broken card.
  const [bands, setBands] = useState<ClubBands | null>(null);
  useEffect(() => {
    if (!activeName) return;
    let live = true;
    fetch(`${BASE}/api/stats/club/bands?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setBands(d as ClubBands))
      .catch(() => live && setBands(null));
    return () => { live = false; };
  }, [activeName]);

  // The radar's `radarColors` MutationObserver lived here. It existed only
  // because recharts writes stroke/fill as SVG attributes, where `var()`
  // cannot resolve — so the colours had to be read out of the computed style
  // and re-read on every `data-theme` flip. DimensionBars are CSS gradients on
  // divs, so the tokens just work and none of that machinery is needed.

  if (!activeName) return null;

  if (loadError) {
    return (
      <div className="glass-card p-5">
        <ErrorState message={t('assess.error')} />
      </div>
    );
  }

  // Loading: reserve the radar card's footprint with a skeleton rather than a
  // blank gap below the Summary segment control. Height is a deliberate middle:
  // the card is short (~240) for a first-time user (empty "rate skills" CTA) and
  // tall (~835) once there's assessment data, so no fixed height matches both.
  // We favor the empty case (a new user's first impression) and let the reveal
  // fade smooth the gentle downward settle for data-rich users.
  if (!loaded) return <CardSkeleton height={320} />;

  // Card chrome wraps every state so the section reads consistently.
  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className="glass-card p-5 space-y-3">
      <CardHeader
        icon="trending_up"
        title={t('assess.heroTitle')}
        action={latest ? (
          <button type="button" onClick={() => setCheckInOpen(true)} className="cc-btn cc-btn-ghost" style={{ whiteSpace: 'nowrap' }}>
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
    // The read + level live in the Level card; here a single card holds the
    // always-on radar with strengths / work-on as legends on the right.
    <div className="animate-fadeIn space-y-3">
      <div className="glass-card p-5 space-y-3">
      {/* Dimension tiles — Technical / Physical / Mental averages, in-card above the radar. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
        {DIMENSIONS.map((dim) => (
          <StatCard
            key={dim}
            tone={DIM_TONE[dim]}
            size="tile"
            label={t(`assess.dim.${dim}`)}
            value={fmt(latest.dimensionScores?.[dim] ?? null)}
          />
        ))}
      </div>

      {/* Dimension bars, full width — replaces the 14-axis radar. */}
      <DimensionBars
        scores={latest.dimensionScores ?? {}}
        prevScores={prev?.dimensionScores ?? undefined}
        medians={bands?.dimensionMedians ?? null}
        // Ticks require BOTH a revealed comparison and a big enough cohort.
        // The server already withholds `skills` unless the prompt was answered
        // and the preference is on, so a non-empty `skills` array is the
        // client-side proof that a comparison is legitimately visible — the
        // medians alone are not, since the club spread is returned even to
        // members who opted out.
        showTicks={!!bands && bands.cohort >= bands.minCohort && bands.skills.length > 0}
      />

      {/* Strengths / work-on legends, side by side below the bars. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <Legend title={t('assess.strengths')} items={strengths} nowMap={nowMap} accent />
        <Legend title={t('assess.workOn')} items={workOn} nowMap={nowMap} />
      </div>

      {/* The then/now key is gone with the radar — each bar now carries its own
          delta arrow, so a separate colour key would explain nothing. The
          first-rating hint stays. */}
      {!prev && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>{t('assess.baseline')}</p>
      )}

      {insightsOn && insight?.trend && <InsightChip {...insight.trend} />}

      {/* Actions — Update (re-rate) + All skills toggle share one row, same level. */}
      <div className="space-y-3">
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            type="button"
            onClick={() => setCheckInOpen(true)}
            className="cc-btn cc-btn-ghost"
            style={{ flex: 1, justifyContent: 'center', whiteSpace: 'nowrap' }}
          >
            {t('assess.reRate')}
          </button>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            className="cc-btn cc-btn-ghost"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {showAll ? t('assess.hideSkills') : t('assess.allSkills')}
          </button>
        </div>
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
      </div>

      {sheetSkill && (
        <SkillAnchorSheet skillKey={sheetSkill} value={nowMap.get(sheetSkill) ?? 0} onClose={() => setSheetSkill(null)} />
      )}

      <CheckInSheet name={activeName} open={checkInOpen} onClose={() => setCheckInOpen(false)} onSaved={load} previous={nowMap} />
    </div>
  );
}

function Legend({
  title, items, nowMap, accent,
}: {
  title: string;
  items: Rating[];
  nowMap: Map<string, number>;
  accent?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="section-label" style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: 0 }}>{title}</p>
      {items.map((r) => {
        const skill = SKILL_BY_KEY.get(r.skillKey);
        if (!skill) return null;
        const v = nowMap.get(r.skillKey) ?? r.value;
        return (
          <div key={r.skillKey} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', lineHeight: 1.3, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.label}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', fontWeight: 700, color: accent ? 'var(--accent)' : 'var(--text-muted)' }}>{v}</span>
          </div>
        );
      })}
    </div>
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
      <p className="section-label" style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: 0 }}>{title}</p>
      {items.map((r) => {
        const skill = SKILL_BY_KEY.get(r.skillKey);
        if (!skill) return null;
        const thenV = thenMap.get(r.skillKey);
        const nowV = nowMap.get(r.skillKey) ?? r.value;
        return (
          <ListRow
            key={r.skillKey}
            onClick={() => onPick(r.skillKey)}
            ariaLabel={skill.label}
            title={<span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.2 }}>{skill.label}</span>}
            trailing={
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-primary)' }}>{nowV}</span>
                {thenV !== undefined && <Delta value={nowV - thenV} />}
              </span>
            }
          />
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
            <span className="material-icons" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}>close</span>
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
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-base)', fontWeight: 700, color: isActive ? 'var(--accent, #22c55e)' : 'var(--text-muted)' }}>{level}</span>
                    {isActive && (
                      <span className="material-icons" style={{ fontSize: 'var(--icon-sm)', color: 'var(--accent, #22c55e)' }}>check_circle</span>
                    )}
                  </div>
                  <p style={{ fontSize: 'var(--fs-base)', lineHeight: 1.45, color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', margin: 0 }}>{anchor}</p>
                </div>
              );
            })}
          </div>
        </BottomSheetBody>
      </div>
    </BottomSheet>
  );
}
