'use client';

import { useTranslations } from 'next-intl';
import { MIN_LB, MAX_LB } from '@/lib/tension';

export interface TensionStepperProps {
  /** What the member has chosen, or null for nothing chosen yet. */
  value: number | null;
  /** Where the stepper starts when nothing is chosen (a pairing's figure).
   *  Rendered MUTED — a suggestion must never read as something the member
   *  said. With neither, the stepper shows a dash and starts mid-range. */
  suggested?: number | null;
  onChange: (lbs: number) => void;
  disabled?: boolean;
}

const MID_LB = Math.round((MIN_LB + MAX_LB) / 2);

/** − 26 + lb, whole pounds, clamped to the same range `lib/tension.ts` advises in. */
export default function TensionStepper({ value, suggested = null, onChange, disabled = false }: TensionStepperProps) {
  const t = useTranslations('stats.gear.setup');
  const shown = value ?? suggested;
  const base = shown ?? MID_LB;
  const step = (delta: number) => {
    // The first tap on an unchosen stepper CHOOSES the shown number (±1), so
    // the member's first action moves from what they can see.
    onChange(Math.min(MAX_LB, Math.max(MIN_LB, base + delta)));
  };
  return (
    <span className="setup-stepper">
      <button type="button" onClick={() => step(-1)} disabled={disabled || (value !== null && value <= MIN_LB)} aria-label={t('tensionLower')}>
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-sm)' }}>remove</span>
      </button>
      <span
        className={`setup-stepper-value${value === null ? ' setup-stepper-value--suggested' : ''}`}
        aria-live="polite"
      >
        {shown ?? '–'}
      </span>
      <button type="button" onClick={() => step(1)} disabled={disabled || (value !== null && value >= MAX_LB)} aria-label={t('tensionRaise')}>
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-sm)' }}>add</span>
      </button>
    </span>
  );
}
