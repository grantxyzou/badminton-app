'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import ListRow from '@/components/primitives/ListRow';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import type { UseGear, GearPrefs } from './useGear';
import { FIT_GOALS, FIT_SWINGS, FIT_ARM_COMFORTS, FIT_GRIPS, type FitGoal, type FitGrip } from '@/lib/types';

export interface GearFitSheetProps {
  open: boolean;
  onClose: () => void;
  /** The register's single `UseGear`. Every answer is written through it, so
   *  the pick rail re-asks off the same doc with no second fetch. */
  gear: UseGear;
}

/** String-budget bands, CAD per restring. Every band is an UPPER bound, the
 *  same rule as the racket bands; `null` is "no limit". A string set is a
 *  $10–40 purchase, so the racket bands ($100–350) would all read as "no
 *  limit" here. */
const STRING_BUDGET_BANDS: ReadonlyArray<[number | null, string]> = [
  [15, 'stringBudget_15'],
  [25, 'stringBudget_25'],
  [40, 'stringBudget_40'],
  [null, 'stringBudget_none'],
];

/**
 * The fit questionnaire — what a shop asks that a skill check-in cannot.
 *
 * Its own sheet rather than five more controls inside `GearPickSheet`'s
 * preference block: that block is "set once or twice a year" and folded
 * behind a Change link on purpose, and the arm-or-shoulder question needs a
 * disclosure sentence and a Clear affordance that a segment row cannot carry.
 *
 * Every tap is one write through `gear.setPrefs` — there is no Save button,
 * because a half-answered questionnaire is a valid state (every field is
 * optional) and a Save that persists nothing new is a button that lies. The
 * result of each write is RENDERED (one `ErrorState` slot), never dropped:
 * calling a refused write as `void setPrefs(...)` is what once made a refused
 * operation indistinguishable from a dead button elsewhere in this register.
 *
 * A failed or pending gear read means the stored answers are UNKNOWN. The
 * controls still render — they are what writes the doc, so they are also the
 * only way to clear an answer the member no longer wants stored — but no
 * option lights up out of a `??` fallback, because that would assert an answer
 * the server never reported.
 */
export default function GearFitSheet({ open, onClose, gear }: GearFitSheetProps) {
  const t = useTranslations('stats.gear');
  const tGearErr = useTranslations('valueHub');
  const tRecovery = useTranslations('recovery');
  const tStats = useTranslations('stats');
  const [error, setError] = useState<string | null>(null);

  const known = gear.loaded && !gear.loadError;
  const doc = known ? gear.gear : null;
  const goal = known ? (doc?.fitGoal ?? null) : undefined;
  const swing = known ? (doc?.fitSwing ?? null) : undefined;
  const arm = known ? (doc?.fitArmComfort ?? null) : undefined;
  const grip = known ? (doc?.fitGrip ?? null) : undefined;
  const stringBudget = known ? (doc?.stringBudgetMaxCad ?? null) : undefined;
  const hasRacket = gear.rackets.length > 0;

  function close() {
    setError(null);
    onClose();
  }

  async function setPref(prefs: GearPrefs) {
    if (gear.busy) return;
    setError(null);
    const res = await gear.setPrefs(prefs);
    if (res.ok) return;
    if (res.reason === 'unauthorized') setError(tGearErr('bagSignInAgain'));
    else if (res.reason === 'member_not_found') setError(tGearErr('bagMemberMissing'));
    else if (res.reason === 'rate_limited') setError(tGearErr('bagRateLimited'));
    else setError(t('fitSaveError'));
  }

  /** The band's own words for the read-only summary — never "no limit" for a
   *  value it does not recognise. */
  function budgetWords(band: number | null): string {
    if (band === null) return t('budgetLower_none');
    if (band === 100) return t('budgetLower_100');
    if (band === 200) return t('budgetLower_200');
    if (band === 350) return t('budgetLower_350');
    return `$${band}`;
  }

  const sectionStyle = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' } as const;
  const labelStyle = { margin: '0', color: 'var(--text-secondary)' } as const;
  const linkStyle = { background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', color: 'var(--accent)' } as const;

  function segment<T extends string | number | null>(
    label: string,
    options: ReadonlyArray<[T, string]>,
    current: T | undefined,
    write: (v: T) => GearPrefs,
  ) {
    return (
      <div className="segment-control flex" role="tablist" aria-label={label}>
        {options.map(([value, key]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={current !== undefined && current === value}
            disabled={gear.busy}
            className={`flex-1 flex items-center justify-center fs-sm ${current !== undefined && current === value ? 'segment-tab-active' : 'segment-tab-inactive'}`}
            onClick={() => setPref(write(value))}
          >
            {t(key)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <BottomSheet open={open} onClose={close} ariaLabel={t('fitTitle')} maxHeight="88dvh">
      <BottomSheetHeader>
        <span
          className="fs-2xs"
          style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}
        >
          {t('fitTitle')}
        </span>
        <button
          type="button"
          onClick={close}
          aria-label={tRecovery('close')}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>

      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <p className="fs-md" style={{ margin: '0', color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>
            {t('fitIntro')}
          </p>

          {/* Format and budget stay where they are edited (the racket pick);
              shown here read-only so the sheet is a complete picture of what
              the engine has been told. Omitted, not defaulted, when unknown. */}
          {known && (
            <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
              {t('fitPrefsReadOnly', {
                summary: `${t(`formatLower_${doc?.playFormat ?? 'both'}`)} · ${budgetWords(doc?.budgetMaxCad ?? null)}`,
              })}
            </p>
          )}

          {/* Goal: a vertical list, not a segment — five labels do not fit a
              phone-width tab strip. The selected row carries a check. */}
          <section style={sectionStyle} role="group" aria-label={hasRacket ? t('fitGoalLabel') : t('fitGoalLabelNoRacket')}>
            <p className="fs-sm" style={labelStyle}>{hasRacket ? t('fitGoalLabel') : t('fitGoalLabelNoRacket')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {FIT_GOALS.map((g: FitGoal) => {
                const selected = goal !== undefined && goal === g;
                return (
                  <ListRow
                    key={g}
                    onClick={gear.busy ? undefined : () => setPref({ fitGoal: g })}
                    ariaLabel={t(`fitGoal_${g}`)}
                    title={
                      <span className="fs-md" style={{ color: selected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {t(`fitGoal_${g}`)}
                      </span>
                    }
                    trailing={selected ? (
                      <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--accent)' }}>
                        check
                      </span>
                    ) : undefined}
                  />
                );
              })}
            </div>
          </section>

          <section style={sectionStyle}>
            <p className="fs-sm" style={labelStyle}>{t('fitSwingLabel')}</p>
            {segment(t('fitSwingLabel'), FIT_SWINGS.map((s) => [s, `fitSwing_${s}`] as const), swing, (v) => ({ fitSwing: v }))}
          </section>

          <section style={sectionStyle}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
              <p className="fs-sm" style={labelStyle}>{t('fitArmLabel')}</p>
              {/* Only when there is something to clear: a Clear that clears
                  nothing is a button that lies. */}
              {arm != null && (
                <button type="button" className="fs-sm" style={linkStyle} disabled={gear.busy} onClick={() => setPref({ fitArmComfort: null })}>
                  {t('fitClear')}
                </button>
              )}
            </div>
            {segment(t('fitArmLabel'), FIT_ARM_COMFORTS.map((a) => [a, `fitArm_${a}`] as const), arm, (v) => ({ fitArmComfort: v }))}
            <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>
              {t('fitArmNote')}
            </p>
          </section>

          <section style={sectionStyle}>
            <p className="fs-sm" style={labelStyle}>{t('fitGripLabel')}</p>
            {segment<FitGrip | null>(
              t('fitGripLabel'),
              [...FIT_GRIPS.map((g) => [g, `fitGrip_${g}`] as [FitGrip | null, string]), [null, 'fitGripUnsure']],
              grip,
              (v) => ({ fitGrip: v }),
            )}
          </section>

          <section style={sectionStyle}>
            <p className="fs-sm" style={labelStyle}>{t('fitStringBudgetLabel')}</p>
            {segment(t('fitStringBudgetLabel'), STRING_BUDGET_BANDS, stringBudget, (v) => ({ stringBudgetMaxCad: v }))}
          </section>

          {gear.loadError && <ErrorState message={t('kitError')} />}
          {error && <ErrorState message={error} />}
          {!gear.online && (
            <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>{tStats('offline')}</p>
          )}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
