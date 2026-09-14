'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MIN_LB, MAX_LB } from '@/lib/tension';
// The rated window lives beside the scale it defaults to; re-exported for the sheets.
export { ratedRange } from '@/lib/tension';
import type { ClubTensionBand } from '@/lib/clubTension';

/** The widest number the field will hold. Wider than any rated range on
 *  purpose: an out-of-range figure warns but still saves (the member may know
 *  something the catalog does not). */
export const FIELD_MIN_LB = 10;
export const FIELD_MAX_LB = 40;

export interface TensionFieldProps {
  /** What the member has chosen, or null for nothing chosen yet. */
  value: number | null;
  /** A starting figure nobody chose (a pairing's), shown as the placeholder. */
  suggested?: number | null;
  onChange: (lbs: number | null) => void;
  /** The racket's rated window, when the catalog prints one. */
  rated?: [number, number] | null;
  /** The club's band for this frame; null says nothing. */
  club?: ClubTensionBand | null;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Accessible name for the input, e.g. "Strung at". */
  label: string;
}

/**
 * Tension as a FIELD, not a display (design "Equipment redesign" 2a, screen 03).
 * The old `− 26 +` read as a value nobody could type into. The numeric keypad
 * opens on focus; the steppers nudge a pound within the frame's rated range and
 * stop at its edges; a typed figure outside the range warns and still saves.
 */
export default function TensionField({ value, suggested = null, onChange, rated = null, club = null, autoFocus = false, disabled = false, label }: TensionFieldProps) {
  const t = useTranslations('stats.gear.setup');
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [text, setText] = useState(value === null ? '' : String(value));
  // The member's own typing wins while it still says the value; when the
  // parent moves the value (Don't know, a stepper, a reset) the field follows.
  const typed = parseLbs(text);
  const shownText = typed === value ? text : value === null ? '' : String(value);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const [lo, hi] = rated ?? [MIN_LB, MAX_LB];
  const base = value ?? suggested ?? Math.round((lo + hi) / 2);

  function commit(raw: string) {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 2);
    setText(digits);
    onChange(parseLbs(digits));
  }

  function step(delta: number) {
    // The first tap on an empty field CHOOSES the shown figure ±1, so the
    // member's first action moves from what they can see.
    const next = Math.min(hi, Math.max(lo, base + delta));
    setText(String(next));
    onChange(next);
  }

  const outOfRange = rated !== null && value !== null && (value < rated[0] || value > rated[1]);
  const clubLine = club ? t('tensionClubHint', { low: club.low, high: club.high }) : null;

  return (
    <div className="tension-field">
      <div className="tension-field-row">
        <button type="button" className="tension-field-step" onClick={() => step(-1)}
          disabled={disabled || (value !== null && value <= lo)} aria-label={t('tensionLower')}>
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)' }}>remove</span>
        </button>
        <label className="tension-field-box">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label={label}
            aria-describedby={clubLine || outOfRange ? hintId : undefined}
            aria-invalid={outOfRange || undefined}
            value={shownText}
            placeholder={suggested !== null ? String(suggested) : '–'}
            onChange={(e) => commit(e.target.value)}
            disabled={disabled}
          />
          <span className="tension-field-unit">{t('lbUnit')}</span>
        </label>
        <button type="button" className="tension-field-step tension-field-step--up" onClick={() => step(1)}
          disabled={disabled || (value !== null && value >= hi)} aria-label={t('tensionRaise')}>
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)' }}>add</span>
        </button>
      </div>
      {(outOfRange || clubLine) && (
        <p id={hintId} className="tension-field-hint">
          {outOfRange && rated
            ? <span className="tension-field-warn">{t('tensionOutOfRange', { low: rated[0], high: rated[1] })}</span>
            : clubLine}
        </p>
      )}
    </div>
  );
}

/** Whole pounds from the field's text. A single digit is a figure still being
 *  typed ("2" on the way to "24"), not ten pounds: it is nothing yet. */
export function parseLbs(text: string): number | null {
  if (text === '') return null;
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n) || n < FIELD_MIN_LB) return null;
  return Math.min(FIELD_MAX_LB, n);
}

