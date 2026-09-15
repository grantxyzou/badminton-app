'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import Switch from '@/components/primitives/Switch';
import ErrorState from '@/components/primitives/ErrorState';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { recordEngagement } from '@/lib/engagement';
import { gearFailureMessage } from '@/lib/gearFailureMessage';
import { fitAnswers, nearestLevelOption } from '@/lib/fitProfile';
import { racketSrc } from '@/lib/racketLook';
import { FIT_GOALS, FIT_LEVEL_OPTIONS, FIT_PLAY_STYLES, type FitPlayStyle, type PlayerGear } from '@/lib/types';
import type { FitFacts } from '@/lib/fitVerdict';
import type { UseGear, GearPrefs } from './useGear';
import type { UseGearPicks } from './useGearPicks';
import { useFitVerdict, type FitVerdictData } from './useFitVerdict';
import { useStatsTakeover } from './statsTakeover';
import { GripSizePicker, SorenessPicker, SwingSpeedPicker } from './FitPickers';

export interface FitProfilePageProps {
  activeName: string | null;
  /** The register's one gear owner; every answer is written through it. */
  gear: UseGear;
  /** The register's picks, for "If you ever replace it". */
  picks: UseGearPicks;
  onBack: () => void;
  /** A ranked frame's own page, when pages are on. */
  onOpenFrame?: (frameId: string) => void;
}

type Answerable = keyof Pick<GearPrefs, 'fitLevelOverride' | 'fitPlayStyle' | 'playFormat' | 'fitSwing' | 'fitGrip' | 'fitOvergrips' | 'fitSoreness' | 'fitGoal'>;

/** How long the answers must be still before the ranking is re-asked. */
const RANK_SETTLE_MS = 2500;

const FORMAT_OF: Record<FitPlayStyle, 'singles' | 'doubles' | 'both'> = { doubles: 'doubles', singles: 'singles', mixed: 'both', any: 'both' };

/**
 * "Your fit" (design "Equipment redesign", Turn 3, 3a) — five questions and
 * the verdict they add up to, as a page in the Gear register.
 *
 * AUTOSAVING. Every control writes at once; the tapped answer shows
 * immediately and reverts, with a way to try again, if the write is refused.
 * Writes are QUEUED, one after another: the gear PATCH reads the doc and
 * writes it back, so two taps racing would each keep only their own answer.
 *
 * The verdict is the server's (`/api/equipment/fit-verdict`) and keeps showing
 * the previous one while a new one is asked for — no spinner on the verdict.
 */
export default function FitProfilePage({ activeName, gear, picks, onBack, onOpenFrame }: FitProfilePageProps) {
  const t = useTranslations('stats.gear.fitPage');
  const tGear = useTranslations('stats.gear');
  const tHub = useTranslations('valueHub');
  useStatsTakeover(true);

  const known = gear.loaded && !gear.loadError;
  const doc = known ? gear.gear : null;
  const verdict = useFitVerdict(activeName, doc, known);

  const [pending, setPending] = useState<Partial<GearPrefs>>({});
  const [failed, setFailed] = useState<{ prefs: GearPrefs; message: string } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    window.scrollTo?.(0, 0);
    void recordEngagement('fit_profile_opened');
  }, []);

  // One verdict_shown per visit, the first time a judged verdict is on screen.
  const shownRef = useRef(false);
  const shownState = verdict.data?.facts.state;
  useEffect(() => {
    if (shownRef.current || !shownState || shownState === 'insufficient') return;
    shownRef.current = true;
    void recordEngagement('verdict_shown', { catalogId: gear.active?.catalogId ?? undefined });
  }, [shownState, gear.active?.catalogId]);

  function value<K extends Answerable>(key: K): GearPrefs[K] | undefined {
    if (key in pending) return pending[key];
    return (doc?.[key as keyof PlayerGear] as GearPrefs[K] | undefined) ?? undefined;
  }

  function answer(prefs: GearPrefs) {
    setFailed(null);
    setPending((p) => ({ ...p, ...prefs }));
    void recordEngagement('fit_answer_set');
    queue.current = queue.current.then(async () => {
      const res = await gear.setPrefs(prefs);
      setPending((p) => {
        const next = { ...p };
        for (const k of Object.keys(prefs) as Answerable[]) if (next[k] === prefs[k]) delete next[k];
        return next;
      });
      if (!res.ok) setFailed({ prefs, message: res.reason === 'error' ? t('saveError') : gearFailureMessage(res.reason, tHub) });
    }).catch(() => {
      // Never let one failure break the queue for every tap after it.
      setPending({});
      setFailed({ prefs, message: t('saveError') });
    });
  }

  // "If you ever replace it" re-asks once the answers have been still for a
  // moment. The register holds fit-driven refetches while this page is open
  // (every tap would otherwise spend the recommend limit), so without this the
  // ranking would describe the member from before they opened the page.
  const answerKey = JSON.stringify([doc?.fitSwing, doc?.fitGrip, doc?.fitGoal, doc?.fitSoreness, doc?.fitPlayStyle, doc?.fitLevelOverride]);
  const firstKey = useRef(answerKey);
  const { refresh } = picks;
  useEffect(() => {
    if (answerKey === firstKey.current) return;
    const timer = setTimeout(() => refresh('racket'), RANK_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [answerKey, refresh]);

  // The answers as the page shows them: stored, with any tap still in flight on top.
  const shown = { ...(doc ?? {}), ...pending } as PlayerGear;
  const answers = fitAnswers(known ? shown : null, verdict.data?.checkInLevel ?? null);
  const level = value('fitLevelOverride') ?? nearestLevelOption(verdict.data?.checkInLevel ?? null);
  const disabled = !known || !gear.online;

  return (
    <div className="animate-slideInRight fit-page">
      {/* No right slot: the app's fixed language and theme toggles sit there. */}
      <TopBar title={t('title')} onBack={onBack} backLabel={t('back')} />

      <VerdictCard data={verdict.data} error={verdict.error} forbidden={verdict.forbidden} onRetry={verdict.retry} known={known} hasRacket={gear.rackets.length > 0} onBack={onBack} />

      <div className="fit-section-head">
        <p className="setup-eyebrow">{t('builtOn')}</p>
        {known && <span className="fit-counter">{t('counter', { n: answers.answered })}</span>}
      </div>

      {failed && (
        <ErrorState
          message={failed.message}
          action={<button type="button" className="cc-btn cc-btn-ghost" onClick={() => answer(failed.prefs)} disabled={!gear.online}>{t('retry')}</button>}
        />
      )}

      {gear.loadError ? (
        <ErrorState
          message={t('loadError')}
          action={<button type="button" className="cc-btn cc-btn-ghost" onClick={gear.reload} disabled={!gear.online}>{t('retry')}</button>}
        />
      ) : !known ? (
        <CardSkeleton height={520} />
      ) : (
        <div className="glass-card p-5 fit-questions">
          <section className="fit-group">
            <div className="fit-group-head">
              <span className="fit-q-label">{t('level')}</span>
              {value('fitLevelOverride')
                ? <span className="fit-q-hint">{t('levelYours')}</span>
                : verdict.data?.checkInLevel != null && <span className="fit-q-hint">{t('levelFromCheckIn')}</span>}
            </div>
            <div className="segment-control flex w-full" role="radiogroup" aria-label={t('level')}>
              {FIT_LEVEL_OPTIONS.map((o) => (
                <button key={o} type="button" role="radio" aria-checked={level === o} disabled={disabled}
                  className={`flex-1 flex items-center justify-center fs-sm fit-mono ${level === o ? 'segment-tab-active' : 'segment-tab-inactive'}`}
                  onClick={() => answer({ fitLevelOverride: o })}>
                  {o}
                </button>
              ))}
            </div>
          </section>

          <section className="fit-group">
            <span className="fit-q-label">{t('playStyle')}</span>
            <div className="setup-feel-chips" role="radiogroup" aria-label={t('playStyle')}>
              {FIT_PLAY_STYLES.map((s) => {
                const on = value('fitPlayStyle') === s;
                return (
                  <button key={s} type="button" role="radio" aria-checked={on} className="setup-feel-chip" disabled={disabled}
                    // Doubles and singles are what the engines call a format;
                    // mixed and "whatever's free" are both.
                    onClick={() => answer({ fitPlayStyle: s, playFormat: FORMAT_OF[s] })}>
                    {t(`style_${s}`)}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="fit-group">
            <div className="fit-group-head">
              <span className="fit-q-label">{t('swing')}</span>
              {value('fitSwing') && <span className="fit-q-value">{t(`swing_${value('fitSwing')}`)}</span>}
            </div>
            <SwingSpeedPicker value={value('fitSwing') ?? null} onChange={(v) => answer({ fitSwing: v })} disabled={disabled} label={t('swing')} />
            <p className="fit-caption">{t('swingCaption')}</p>
          </section>

          <section className="fit-group">
            <span className="fit-q-label">{t('grip')}</span>
            <GripSizePicker value={value('fitGrip') ?? null} onChange={(v) => answer({ fitGrip: v })} disabled={disabled} label={t('grip')} />
            <p className="fit-caption">{t('gripCaption')}</p>
            <div className="fit-overgrips">
              <span id="fit-overgrips-label">{t('overgrips')}</span>
              <Switch checked={value('fitOvergrips') === 2} onChange={(on) => answer({ fitOvergrips: on ? 2 : 0 })} ariaLabel={t('overgrips')} disabled={disabled} />
            </div>
          </section>

          <section className="fit-group">
            <span className="fit-q-label">{t('sore')}</span>
            <SorenessPicker value={value('fitSoreness') ?? null} onChange={(v) => answer({ fitSoreness: v })} disabled={disabled} label={t('sore')} />
            {/* Only when the answer actually moved the range: a line explaining
                a change that did not happen would be a small lie. */}
            {value('fitSoreness') && value('fitSoreness') !== 'none' && verdict.data?.facts.sorenessMovedRange && (
              <p className="fit-consequence">{t('soreConsequence')}</p>
            )}
          </section>

          <section className="fit-group">
            <span className="fit-q-label">{t('goal')}</span>
            <div className="setup-feel-chips" role="radiogroup" aria-label={t('goal')}>
              {FIT_GOALS.map((g) => {
                const on = value('fitGoal') === g;
                return (
                  <button key={g} type="button" role="radio" aria-checked={on} className="setup-feel-chip" disabled={disabled} onClick={() => answer({ fitGoal: g })}>
                    {tGear(`fitGoal_${g}`)}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      <p className="setup-eyebrow fit-section-label">{t('replaceTitle')}</p>
      <RankedFrames picks={picks} ready={!!answers.swing && !!answers.grip} onOpenFrame={onOpenFrame} />

      <p className="fit-footnote">{t('privacy')}</p>
    </div>
  );
}

function VerdictCard({ data, error, forbidden, onRetry, known, hasRacket, onBack }: {
  data: FitVerdictData | null; error: boolean; forbidden: boolean; onRetry: () => void; known: boolean; hasRacket: boolean; onBack: () => void;
}) {
  const t = useTranslations('stats.gear.fitPage');
  const tHub = useTranslations('valueHub');

  if (known && !hasRacket) {
    return (
      <div className="glass-card p-5 fit-verdict">
        <p className="setup-eyebrow">{t('verdictEyebrow')}</p>
        <p className="fit-body">{t('noRacket')}</p>
        <button type="button" className="setup-link" style={{ alignSelf: 'flex-start' }} onClick={onBack}>{t('noRacketLink')}</button>
      </div>
    );
  }
  if (!data) {
    if (error && forbidden) return <ErrorState message={tHub('bagSignInAgain')} />;
    if (error) return <ErrorState message={t('loadError')} action={<button type="button" className="cc-btn cc-btn-ghost" onClick={onRetry}>{t('retry')}</button>} />;
    return <CardSkeleton height={240} />;
  }

  const { facts, copy } = data;
  const judged = facts.state !== 'insufficient';
  const frame = facts.frame?.name ?? '';
  const range = facts.tensionRange ? t('lbRange', { low: facts.tensionRange[0], high: facts.tensionRange[1] }) : null;
  const tag = [facts.frame?.balance, facts.frame?.weightClass, range].filter(Boolean).join(' · ');
  const eyebrow = facts.state === 'suits' ? 'setup-eyebrow--accent' : judged ? 'fit-eyebrow--warn' : '';
  const needsFeel = !judged && !!facts.frame && (!facts.frame.balance || !facts.frame.flex);

  return (
    <div className="glass-card p-5 fit-verdict" aria-live="polite">
      <p className={`setup-eyebrow ${eyebrow}`}>{t('verdictEyebrow')}</p>
      <h2 className="fit-headline">{copy?.headline ?? t(`headline_${facts.state}`, { frame })}</h2>
      <p className="fit-body">{copy?.body ?? (needsFeel ? t('body_needsFeel') : t(`body_${facts.state}`))}</p>

      {judged && facts.reasons.length > 0 && (
        <ul className="fit-reasons">
          {facts.reasons.map((r, i) => (
            <li key={r.key} className={`fit-reason fit-reason--${r.polarity}`}>
              <span className="material-icons" aria-hidden="true">{r.polarity === 'plus' ? 'add' : 'remove'}</span>
              <span>{copy?.reasons[i] ?? t(`reason_${r.key}`)}</span>
            </li>
          ))}
        </ul>
      )}

      {judged && range && (
        <>
          <div className="fit-callout">
            <span className="fit-callout-label">{t('stringItAt')}</span>
            <span className="fit-callout-value">{range}</span>
          </div>
          <p className="fit-caption">{tensionCaption(facts, t)}</p>
          {tag && (
            <div className="fit-tag-row">
              <span className="fit-caption">{t('tagLabel')}</span>
              <span className="fit-tag">{tag}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function tensionCaption(facts: FitFacts, t: (key: string, values?: Record<string, number>) => string): string {
  const [lo, hi] = facts.tensionRange!;
  const now = facts.currentTensionLbs;
  if (now === null) return t('tensionNone');
  if (now > hi) return t('tensionDown', { n: now - hi });
  if (now < lo) return t('tensionUp', { n: lo - now });
  return t('tensionInside');
}

function RankedFrames({ picks, ready, onOpenFrame }: { picks: UseGearPicks; ready: boolean; onOpenFrame?: (frameId: string) => void }) {
  const t = useTranslations('stats.gear.fitPage');
  // The handoff's threshold: a ranking needs the swing and the grip.
  if (!ready) return <div className="glass-card p-5"><p className="fit-caption" style={{ margin: 0 }}>{t('rankedNeeds')}</p></div>;
  const { status, pick } = picks.view.racket;
  if (status === 'loading') return <CardSkeleton height={160} />;
  if (!pick) return <div className="glass-card p-5"><p className="fit-caption" style={{ margin: 0 }}>{t('rankedNone')}</p></div>;

  const rows = [
    { item: pick.item, why: pick.reasons[0] },
    ...(pick.alternatives ?? []).map((a) => ({ item: a.item, why: a.differsByText?.[0] ?? a.reasons?.[0] })),
  ].slice(0, 2);

  return (
    <div className="glass-card p-5 fit-ranked">
      {rows.map((r, i) => (
        <button key={r.item.id} type="button" className="fit-rank-row frame-close-row" disabled={!onOpenFrame} onClick={() => onOpenFrame?.(r.item.id)}>
          <span className="fit-rank-thumb" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- a pre-rendered local WebP; next/image adds nothing at 24px. */}
            <img src={racketSrc(r.item.id)} alt="" />
          </span>
          <span className="fit-rank-text">
            <span className="fit-rank-name">{r.item.model}</span>
            {r.why && <span className="fit-caption">{r.why}</span>}
          </span>
          <span className={`fit-rank-n${i === 0 ? ' fit-rank-n--first' : ''}`}>{t(`rank_${i + 1}`)}</span>
        </button>
      ))}
      <p className="fit-caption" style={{ margin: 0 }}>{t('rankedFooter')}</p>
    </div>
  );
}
