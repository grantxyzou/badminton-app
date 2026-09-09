'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import ListRow from '@/components/primitives/ListRow';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import type { UseGear, GearPrefs } from './useGear';
import { FIT_GOALS, FIT_SWINGS, FIT_ARM_COMFORTS, FIT_GRIPS, type FitGoal, type FitGrip, type FitSwing, type FitArmComfort } from '@/lib/types';

export interface GearFitSheetProps {
  open: boolean;
  onClose: () => void;
  /** The register's single `UseGear`. Every answer is written through it, so
   *  the pick rail re-asks off the same doc with no second fetch. */
  gear: UseGear;
}

/** Option lists and shared styles depend on nothing from render, so they are
 *  built once — the rail mounts this sheet unconditionally and re-renders it
 *  on every pass. */
const SWING_OPTIONS: ReadonlyArray<[FitSwing, string]> = FIT_SWINGS.map((v) => [v, `fitSwing_${v}`]);
const ARM_OPTIONS: ReadonlyArray<[FitArmComfort, string]> = FIT_ARM_COMFORTS.map((v) => [v, `fitArm_${v}`]);
const GRIP_OPTIONS: ReadonlyArray<[FitGrip | null, string]> = [
  ...FIT_GRIPS.map((v) => [v, `fitGrip_${v}`] as [FitGrip | null, string]),
  [null, 'fitGripUnsure'],
];
const SECTION_STYLE = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' } as const;
const LABEL_STYLE = { margin: '0', color: 'var(--text-secondary)' } as const;
const LINK_STYLE = { background: 'transparent', border: 'none', padding: '0', cursor: 'pointer', color: 'var(--accent)' } as const;

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
  // Redacted = the route stripped it for a caller it could not tie to the
  // owner. On the owner's own device that means a lapsed member_session; the
  // answer exists, so nothing lights, and the section says why.
  const armRedacted = known && doc?.fitArmComfortRedacted === true;
  const arm = known && !armRedacted ? (doc?.fitArmComfort ?? null) : undefined;
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

  /** The Clear link, only while there is something to clear — the privacy
   *  policy promises every answer can be cleared from this sheet, so every
   *  section that stores one gets this, not only the comfort one. */
  function clearLink(stored: boolean, prefs: GearPrefs) {
    if (!stored) return null;
    return (
      <button type="button" className="fs-sm" style={LINK_STYLE} disabled={gear.busy} onClick={() => setPref(prefs)}>
        {t('fitClear')}
      </button>
    );
  }
  const labelRow = (label: string, clear: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
      <p className="fs-sm" style={LABEL_STYLE}>{label}</p>
      {clear}
    </div>
  );

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
            // A `null` option ("Not sure", "No limit") is a CLEAR, and never
            // lights: the stored doc cannot tell "answered: not sure" from
            // "never asked", so lighting it would assert an answer the member
            // did not give. Absent is absent.
            aria-selected={current !== undefined && value !== null && current === value}
            disabled={gear.busy}
            className={`flex-1 flex items-center justify-center fs-sm ${current !== undefined && value !== null && current === value ? 'segment-tab-active' : 'segment-tab-inactive'}`}
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
          <section style={SECTION_STYLE} role="group" aria-label={hasRacket ? t('fitGoalLabel') : t('fitGoalLabelNoRacket')}>
            {labelRow(hasRacket ? t('fitGoalLabel') : t('fitGoalLabelNoRacket'), clearLink(goal != null, { fitGoal: null }))}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {FIT_GOALS.map((g: FitGoal) => {
                const selected = goal !== undefined && goal === g;
                return (
                  <ListRow
                    key={g}
                    // Always a button. Dropping onClick while busy made
                    // ListRow render a bare div — five rows losing their card
                    // chrome for every round-trip. `setPref` guards busy.
                    // Tapping the selected row clears it, so the list is also
                    // its own undo.
                    onClick={() => setPref({ fitGoal: selected ? null : g })}
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

          <section style={SECTION_STYLE}>
            {labelRow(t('fitSwingLabel'), clearLink(swing != null, { fitSwing: null }))}
            {segment(t('fitSwingLabel'), SWING_OPTIONS, swing, (v) => ({ fitSwing: v }))}
          </section>

          <section style={SECTION_STYLE}>
            {labelRow(t('fitArmLabel'), clearLink(arm != null, { fitArmComfort: null }))}
            {segment(t('fitArmLabel'), ARM_OPTIONS, arm, (v) => ({ fitArmComfort: v }))}
            <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>
              {armRedacted ? t('fitArmRedacted') : t('fitArmNote')}
            </p>
          </section>

          <section style={SECTION_STYLE}>
            <p className="fs-sm" style={LABEL_STYLE}>{t('fitGripLabel')}</p>
            {segment(t('fitGripLabel'), GRIP_OPTIONS, grip, (v) => ({ fitGrip: v }))}
          </section>

          <section style={SECTION_STYLE}>
            <p className="fs-sm" style={LABEL_STYLE}>{t('fitStringBudgetLabel')}</p>
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
