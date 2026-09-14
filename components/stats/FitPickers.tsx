'use client';

import { useTranslations } from 'next-intl';
import { FIT_GRIPS, FIT_SORENESS, FIT_SWINGS, type FitGrip, type FitSoreness, type FitSwing } from '@/lib/types';

/**
 * The fit page's three drawn questions (design "Equipment redesign", Turn 3,
 * 3a). Each is a radiogroup; each tap is one answer.
 */

interface PickerProps<T> {
  value: T | null;
  onChange: (next: T) => void;
  disabled?: boolean;
  label: string;
}

/** Where the arc tops out, in the diagram's own units. The ONLY thing that
 *  differs between the three tiles: apex height is contact height. */
const APEX: Record<FitSwing, number> = { slow: 14, medium: 24, fast: 34 };
const BASELINE = 42;

/**
 * Swing speed as contact height. The handoff forbids the earlier stacked bars
 * — they encoded nothing and read as a loading skeleton — so the drawing must
 * keep meaning "where you meet the shuttle", and the caption must keep saying
 * the scale is ordinal.
 */
export function SwingSpeedPicker({ value, onChange, disabled, label }: PickerProps<FitSwing>) {
  const t = useTranslations('stats.gear.fitPage');
  return (
    <div className="fit-tiles fit-tiles--3" role="radiogroup" aria-label={label}>
      {FIT_SWINGS.map((s) => {
        const top = BASELINE - APEX[s];
        return (
          <button key={s} type="button" role="radio" aria-checked={value === s} className="fit-tile" disabled={disabled} onClick={() => onChange(s)}>
            <svg className="fit-arc" viewBox="0 0 100 52" aria-hidden="true">
              <line x1="0" y1={BASELINE} x2="100" y2={BASELINE} className="fit-arc-base" />
              <path d={`M 4 ${BASELINE} Q 4 ${top} 78 ${top}`} className="fit-arc-path" />
              <circle cx="4" cy={BASELINE} r="1.5" className="fit-arc-origin" />
              <circle cx="78" cy={top} r="4" className="fit-arc-contact" />
            </svg>
            <span className="fit-tile-label">{t(`swing_${s}`)}</span>
            <span className="fit-tile-desc">{t(`swingDesc_${s}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The circumference stamped on the cone, per size. */
const GRIP_MM: Record<FitGrip, number> = { G3: 89, G4: 83, G5: 76, G6: 70 };

/**
 * Grip size as the handle seen end-on, TO SCALE (44 / 38 / 32 / 26 px). The
 * circle sizes live in CSS (`.fit-grip-circle--G3` …) with `flex: 0 0 auto`
 * and `box-sizing: border-box`, which the handoff calls load-bearing: without
 * them the circles squash into ovals and the border inflates the small ones.
 */
export function GripSizePicker({ value, onChange, disabled, label }: PickerProps<FitGrip>) {
  const t = useTranslations('stats.gear.fitPage');
  return (
    <div className="fit-tiles fit-tiles--4" role="radiogroup" aria-label={label}>
      {FIT_GRIPS.map((g) => (
        <button key={g} type="button" role="radio" aria-checked={value === g} className="fit-tile fit-grip-tile" disabled={disabled} onClick={() => onChange(g)}>
          <span className={`fit-grip-circle fit-grip-circle--${g}`} aria-hidden="true" />
          <span className="fit-tile-label">{g}</span>
          <span className="fit-tile-mm">{t('gripMm', { mm: GRIP_MM[g] })}</span>
        </button>
      ))}
    </div>
  );
}

/** Single select; "Nothing sore" is simply the fourth answer, so choosing it
 *  replaces a joint rather than sitting beside one. Amber, because a sore arm
 *  is a caution, not a success. */
export function SorenessPicker({ value, onChange, disabled, label }: PickerProps<FitSoreness>) {
  const t = useTranslations('stats.gear.fitPage');
  return (
    <div className="fit-sore-list" role="radiogroup" aria-label={label}>
      {FIT_SORENESS.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} className="fit-sore-option" disabled={disabled} onClick={() => onChange(s)}>
          <span>{t(`sore_${s}`)}</span>
          {value === s && <span className="material-icons fit-sore-check" aria-hidden="true">check</span>}
        </button>
      ))}
    </div>
  );
}
