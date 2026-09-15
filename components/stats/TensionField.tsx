'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MIN_LB, MAX_LB, FIELD_MIN_LB, FIELD_MAX_LB, rulerScale, scalePosition } from '@/lib/tension';
// The rated window lives beside the scale it defaults to; re-exported for the sheets.
export { ratedRange } from '@/lib/tension';
import type { ClubTensionBand } from '@/lib/clubTension';

export { FIELD_MIN_LB, FIELD_MAX_LB };

export interface TensionFieldProps {
  /** What the member has chosen, or null for nothing chosen yet. */
  value: number | null;
  /** A starting figure nobody chose (a pairing's), shown as the placeholder. */
  suggested?: number | null;
  onChange: (lbs: number | null) => void;
  /** The racket's rated window, when the catalog prints one. */
  rated?: [number, number] | null;
  /** The club's band for this frame. */
  club?: ClubTensionBand | null;
  /** Where the club read is. Given only when there IS a frame to ask about:
   *  then the field draws its ruler and always says something about the club
   *  — the range, "not enough of the club yet", a failed read, or a shimmer —
   *  instead of the same silence for all four. Absent, no ruler, no club line. */
  clubStatus?: 'loading' | 'ready' | 'error';
  autoFocus?: boolean;
  disabled?: boolean;
  /** Accessible name for the input, e.g. "Strung at". */
  label: string;
}

/**
 * Tension as a FIELD, not a display (design "Equipment redesign" 2a, screen 03).
 * The old `− 26 +` read as a value nobody could type into. The numeric keypad
 * opens on focus; the steppers nudge a pound within the frame's rated range and
 * stop at its edges; a typed figure outside the range warns and still saves,
 * and from there the steppers walk it back a pound at a time. With no rated
 * range they are bounded only by what the field holds — people string past 30.
 */
export default function TensionField({ value, suggested = null, onChange, rated = null, club = null, clubStatus, autoFocus = false, disabled = false, label }: TensionFieldProps) {
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

  const [lo, hi] = rated ?? [FIELD_MIN_LB, FIELD_MAX_LB];
  const base = value ?? suggested ?? Math.round(rated ? (lo + hi) / 2 : (MIN_LB + MAX_LB) / 2);

  function commit(raw: string) {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 2);
    setText(digits);
    onChange(parseLbs(digits));
  }

  function step(delta: number) {
    // The first tap on an empty field CHOOSES the shown figure ±1, so the
    // member's first action moves from what they can see.
    // Toward the range always moves one pound; away from it stops at the edge.
    const next = delta > 0 ? Math.min(Math.max(hi, base), base + delta) : Math.max(Math.min(lo, base), base + delta);
    setText(String(next));
    onChange(next);
  }

  const outOfRange = rated !== null && value !== null && (value < rated[0] || value > rated[1]);
  const shown = value ?? suggested;
  const scale = rulerScale([shown, rated?.[0], rated?.[1], clubStatus === 'ready' ? club?.low : null, clubStatus === 'ready' ? club?.high : null]);
  const clubLine = clubStatus === undefined
    ? null
    : clubStatus === 'loading'
      ? <span className="shimmer-line tension-field-shimmer" aria-hidden="true" />
      : clubStatus === 'error'
        ? t('tensionClubError')
        : club
          ? t('tensionClubHint', { low: club.low, high: club.high })
          : t('tensionClubNone');

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
      {clubStatus !== undefined && (
        <TensionRuler value={shown} chosen={value !== null} rated={rated} club={clubStatus === 'ready' ? club : null} outOfRange={outOfRange} scale={scale} label={t('tensionRulerLabel', { low: scale[0], high: scale[1] })} />
      )}
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

/**
 * The field's figure on a 20–30 lb ruler (wider when a figure needs it), live as it changes:
 * the frame's rated window as a faint track, the club's band when three members
 * have logged one, and the member's line moving as they type or step. A figure
 * nobody chose (the suggestion) draws dashed; one outside the rated window
 * turns amber, the same cue as the warning under it.
 */
function TensionRuler({ value, chosen, rated, club, outOfRange, scale, label }: {
  value: number | null; chosen: boolean; rated: [number, number] | null; club: ClubTensionBand | null; outOfRange: boolean; scale: [number, number]; label: string;
}) {
  const at = (lbs: number) => scalePosition(lbs, scale[0], scale[1]);
  const pct = (lbs: number) => `${(at(lbs) * 100).toFixed(2)}%`;
  const span = (lo: number, hi: number) => ({ left: pct(lo), width: `${((at(hi) - at(lo)) * 100).toFixed(2)}%` });
  const ticks = [scale[0], (scale[0] + scale[1]) / 2, scale[1]];
  return (
    <div className="tension-ruler" role="img" aria-label={label}>
      <div className="tension-ruler-track">
        {rated && <span className="tension-ruler-rated" data-testid="ruler-rated" style={span(rated[0], rated[1])} />}
        {club && <span className="tension-ruler-club" data-testid="ruler-club" style={span(club.low, club.high)} />}
        {value !== null && (
          <span
            className={`tension-ruler-you${chosen ? '' : ' tension-ruler-you--suggested'}${outOfRange ? ' tension-ruler-you--warn' : ''}`}
            data-testid="ruler-you"
            style={{ left: pct(value) }}
          />
        )}
      </div>
      <div className="tension-ruler-axis" aria-hidden="true">
        {ticks.map((lb) => <span key={lb}>{lb}</span>)}
      </div>
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

