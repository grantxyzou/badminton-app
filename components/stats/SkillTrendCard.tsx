'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useSkillText } from '@/lib/useSkillText';
import { useActiveName } from '@/lib/useActiveName';
import DimensionBars from './DimensionBars';
import { SKILLS, topStrengths, workOnNext, type Rating, type Dimension, type Phase } from '@/lib/assessment';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import LevelTrendChart from './LevelTrendChart';
import { useLevelRead } from '@/lib/useLevelRead';
import type { UseCheckIn } from './useCheckIn';
import { useRevealReady } from '@/components/primitives/Reveal';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import CardHeader from '@/components/primitives/CardHeader';
import ListRow from '@/components/primitives/ListRow';
import LockedCard, { PreviewMeter, useSignInLink } from './LockedCard';
import Collapse from '@/components/primitives/Collapse';
import { useOpenStatsRegister } from './statsTakeover';


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

function ratingMap(snap: Snapshot | undefined): Map<string, number> {
  return new Map((snap?.ratings ?? []).map((r) => [r.skillKey, r.value]));
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

export default function SkillTrendCard({ checkIn }: { checkIn?: UseCheckIn }) {
  const t = useTranslations('stats');
  const skillText = useSkillText();
  const signInLink = useSignInLink();
  // Shared owner of the identity → preview-name chain. Subscribing (rather
  // than resolving once at mount) is what keeps this card from rendering the
  // PREVIOUS member's trend beside the new member's other cards after a
  // name-to-name sign-in — nothing remounts this island on an identity change.
  const { name: activeName } = useActiveName();
  const [sheetSkill, setSheetSkill] = useState<string | null>(null);
  // History and the sheet both come from the single owner now (`useCheckIn` in
  // `SkillsTab`). This card used to fetch `/api/assessments` itself and mount
  // `CheckInSheet` TWICE — once per branch, with different props.
  const snapshots = (checkIn?.snapshots ?? []) as Snapshot[];
  const loaded = checkIn ? checkIn.status !== 'loading' : true;
  useRevealReady(loaded);
  const loadError = checkIn?.status === 'error';
  const format = useFormatter();
  const openRegister = useOpenStatsRegister();
  // The chart's data: the canonical level and its trail, re-read on a saved
  // check-in (`docs/plans/one-level.md`). Called before any early return.
  const levelRead = useLevelRead(activeName, checkIn?.savedAt ?? 0);

  const latest = snapshots[snapshots.length - 1];
  const prev = snapshots.length > 1 ? snapshots[snapshots.length - 2] : undefined;

  const [showAll, setShowAll] = useState(false);

  // The radar's `radarColors` MutationObserver lived here. It existed only
  // because recharts writes stroke/fill as SVG attributes, where `var()`
  // cannot resolve — so the colours had to be read out of the computed style
  // and re-read on every `data-theme` flip. DimensionBars are CSS gradients on
  // divs, so the tokens just work and none of that machinery is needed.

  if (!activeName) return null;
  // Refused (this device holds no session for the name): the card stays, as
  // its own shape with nothing in it, and Sign in carries the weight.
  if (checkIn?.status === 'forbidden') {
    return (
      <LockedCard icon="trending_up" title={t('assess.heroTitle')} message={t.rich('assess.locked', { link: signInLink })}>
        {SKILLS.slice(0, 4).map((s) => <PreviewMeter key={s.key} label={skillText.label(s.key)} />)}
      </LockedCard>
    );
  }

  // Standalone, not a card holding only an error (the state rule).
  if (loadError) {
    return (
      <ErrorState
        message={t('assess.error')}
        action={
          <button type="button" className="cc-btn cc-btn-ghost" onClick={() => checkIn?.reload()}>
            {t('retry')}
          </button>
        }
      />
    );
  }

  // Loading: reserve the radar card's footprint with a skeleton rather than a
  // blank gap below the Summary segment control. Height is a deliberate middle:
  // the card is short (~240) for a first-time user (empty "rate skills" CTA) and
  // tall (~835) once there's assessment data, so no fixed height matches both.
  // We favor the empty case (a new user's first impression) and let the reveal
  // fade smooth the gentle downward settle for data-rich users.
  if (!loaded) return <CardSkeleton height={320} />;

  // Card chrome wraps every state so the section reads consistently: the
  // title, how much is behind it, and Update as a small pill top right.
  const lastDate = latest ? format.dateTime(new Date(latest.takenAt), { month: 'short', day: 'numeric' }) : null;
  const header = (
    <CardHeader
      icon="trending_up"
      title={t('assess.heroTitle')}
      subtitle={latest && lastDate ? t('assess.heroSubtitle', { count: snapshots.length, date: lastDate }) : undefined}
      action={latest ? (
        <button type="button" onClick={() => checkIn?.openFrom('trend')} className="you-update">
          <span className="material-icons icon-sm" aria-hidden="true">edit</span>
          {t('assess.reRate')}
        </button>
      ) : undefined}
    />
  );

  // Empty — no check-in yet.
  if (!latest) {
    return (
      <>
        <CardFrame header={header}>
          <EmptyState icon="trending_up">{t('assess.empty')}</EmptyState>
          <button type="button" onClick={() => checkIn?.openFrom('trend')} className="cc-btn cc-btn-primary cc-btn-lg" style={{ width: '100%' }}>
            {t('assess.rateSkills')}
          </button>
        </CardFrame>
      </>
    );
  }

  const nowMap = ratingMap(latest);
  const thenMap = ratingMap(prev);
  const strengths = topStrengths(latest.ratings);
  const workOn = workOnNext(latest.ratings);
  const prevDate = prev ? format.dateTime(new Date(prev.takenAt), { month: 'short', day: 'numeric' }) : null;

  return (
    /* YOU AGAINST YOURSELF (Stats canvas, 2026-10-20). Level over time, the
       three sides with their change, and the top and bottom three skills —
       no club figure anywhere: comparing with the club is "Where you sit",
       the one consent-gated card. The dimension tiles that repeated the bars'
       numbers, the trend AI chip (the greeting above carries that voice) and
       the two-button footer are gone. */
    <div className="space-y-3">
      <CardFrame header={header}>
      {checkIn && <LevelTrendChart level={levelRead} onRetry={levelRead.reload} />}

      <div className="you-panel">
        <div className="you-panel-head">
          <p className="you-panel-label">{t('assess.sidesTitle')}</p>
          {prevDate && (
            <span className="you-panel-aside"><span className="you-change" aria-hidden="true">▲</span> {t('assess.sidesSince', { date: prevDate })}</span>
          )}
        </div>
        <DimensionBars scores={latest.dimensionScores ?? {}} prevScores={prev?.dimensionScores ?? undefined} />
      </div>

      {/* The first-rating hint stays: with one check-in there is no change to show. */}
      {!prev && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0', textAlign: 'center' }}>{t('assess.baseline')}</p>
      )}

      <p className="you-lead">{t('assess.listsLead', { count: SKILLS.length })}</p>
      <div className="flex flex-col gap-2">
        <Legend title={t('assess.strengths')} items={strengths} nowMap={nowMap} accent />
        <Legend
          title={t('assess.workOn')}
          items={workOn}
          nowMap={nowMap}
          footer={openRegister ? (
            <button type="button" className="skill-panel-link" onClick={() => openRegister('learn')}>
              <span>{t('assess.openLearn')}</span>
              <span className="material-icons icon-md" aria-hidden="true">chevron_right</span>
            </button>
          ) : undefined}
        />
      </div>

      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        aria-expanded={showAll}
        className="bpm-row-link"
      >
        <span className="fs-md" style={{ fontWeight: 600 }}>
          {showAll ? t('assess.hideSkills') : t('assess.allSkillsCount', { count: SKILLS.length })}
        </span>
        <span className="material-icons icon-md motion-chevron" aria-hidden="true">expand_more</span>
      </button>
      <Collapse open={showAll}>
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
      </Collapse>
      </CardFrame>

      {sheetSkill && (
        <SkillAnchorSheet skillKey={sheetSkill} value={nowMap.get(sheetSkill) ?? 0} onClose={() => setSheetSkill(null)} />
      )}

    </div>
  );
}

/** The card's chrome in every state. At module scope on purpose: a component
 *  declared during render is a new type each render, and React remounts its
 *  whole subtree — the chart, the open skill list — on every state change. */
function CardFrame({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="glass-card p-5 flex flex-col gap-3">
      {header}
      {children}
    </div>
  );
}

/**
 * Strengths / Work on next (Stats canvas, 2026-10-20): full-width tinted lists,
 * one line per skill — the name, then its 1–5 rating as five dots with the
 * number. The tone is set once on the panel and read by the icon, label and
 * dots, so they cannot disagree. Work on next ends in the way to its drills.
 */
function Legend({
  title, items, nowMap, accent, footer,
}: {
  title: string;
  items: Rating[];
  nowMap: Map<string, number>;
  accent?: boolean;
  footer?: React.ReactNode;
}) {
  const skillText = useSkillText();
  const t = useTranslations('stats');
  return (
    <div className={`skill-panel${accent ? '' : ' skill-panel--warn'}`}>
      <div className="skill-panel-head">
        <span className="material-icons icon-sm" aria-hidden="true">{accent ? 'trending_up' : 'flag'}</span>
        <p className="skill-panel-label">{title}</p>
      </div>
      {items.map((r) => {
        const skill = SKILL_BY_KEY.get(r.skillKey);
        if (!skill) return null;
        const v = nowMap.get(r.skillKey) ?? r.value;
        const lit = Math.round(Math.max(0, Math.min(5, v)));
        return (
          <div key={r.skillKey} className="skill-panel-row">
            <span className="skill-panel-name">{skillText.label(skill.key)}</span>
            <span className="skill-dots" role="img" aria-label={t('assess.dotsOf', { value: v })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} className={`skill-dot${n <= lit ? ' is-on' : ''}`} aria-hidden="true" />
              ))}
              <span className="skill-dots-n" aria-hidden="true">{v}</span>
            </span>
          </div>
        );
      })}
      {footer}
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
  const skillText = useSkillText();
  return (
    <div className="space-y-2">
      <p className="section-label" style={{ fontSize: 'var(--fs-2xs)', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0' }}>{title}</p>
      {items.map((r) => {
        const skill = SKILL_BY_KEY.get(r.skillKey);
        if (!skill) return null;
        const thenV = thenMap.get(r.skillKey);
        const nowV = nowMap.get(r.skillKey) ?? r.value;
        return (
          <ListRow
            key={r.skillKey}
            onClick={() => onPick(r.skillKey)}
            ariaLabel={skillText.label(skill.key)}
            title={<span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.2 }}>{skillText.label(skill.key)}</span>}
            trailing={
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--space-1)', whiteSpace: 'nowrap' }}>
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
  const skillText = useSkillText();
  const skill = SKILL_BY_KEY.get(skillKey);
  if (!skill) return null;
  return (
    <BottomSheet open onClose={onClose} ariaLabel={skillText.label(skill.key)}>
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
        <BottomSheetHeader>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{skillText.label(skill.key)}</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center rounded-full"
            style={{ width: 32, height: 32, background: 'var(--inner-card-bg)', border: '1px solid var(--inner-card-border)' }}
          >
            <span className="material-icons" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}>close</span>
          </button>
        </BottomSheetHeader>
        <BottomSheetBody bare className="px-5 pb-8" style={{ paddingBottom: 'max(var(--space-8), env(safe-area-inset-bottom))' }}>
          <div className="space-y-2">
            {skillText.anchors(skill.key).map((anchor, i) => {
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-05)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-base)', fontWeight: 700, color: isActive ? 'var(--accent, #22c55e)' : 'var(--text-muted)' }}>{level}</span>
                    {isActive && (
                      <span className="material-icons" style={{ fontSize: 'var(--icon-sm)', color: 'var(--accent, #22c55e)' }}>check_circle</span>
                    )}
                  </div>
                  <p style={{ fontSize: 'var(--fs-base)', lineHeight: 1.45, color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', margin: '0' }}>{anchor}</p>
                </div>
              );
            })}
          </div>
        </BottomSheetBody>
      </div>
    </BottomSheet>
  );
}
