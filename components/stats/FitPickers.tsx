'use client';

import { useTranslations } from 'next-intl';
import { FIT_GRIPS, FIT_PLAY_STYLE_CHOICES, FIT_SORENESS, FIT_SWINGS, type FitGrip, type FitPlayStyle, type FitSoreness, type FitSwing } from '@/lib/types';

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

/** The court seen from the side, in the diagram's own units: you at the left
 *  back line, the net in the middle, the far back line on the right. */
const COURT = { w: 120, h: 42, floor: 31, you: 4, net: 60, back: 116, hit: 20 } as const;
/** Where the clear lands, per answer. The ONLY thing that differs between the
 *  three tiles: a harder hit carries deeper. Mid-court, near the back, on the
 *  line. */
const LANDING: Record<FitSwing, number> = { slow: 86, medium: 104, fast: 114 };

/**
 * Swing speed as the length of your clear (Grant, Stats canvas, 2026-10-19).
 * The earlier drawing showed where you MEET the shuttle, and needed a caption
 * to explain itself; every player knows where their clear lands. The answers
 * stay `slow` / `medium` / `fast` — the string and racket engines read the
 * same three values they always did, this is only how the question is put.
 */
export function SwingSpeedPicker({ value, onChange, disabled, label }: PickerProps<FitSwing>) {
  const t = useTranslations('stats.gear.fitPage');
  return (
    <div className="fit-tiles fit-tiles--3" role="radiogroup" aria-label={label}>
      {FIT_SWINGS.map((s) => {
        const x = LANDING[s];
        // A clear: up off the racket at the back, high over the net, falling
        // steeply at the end. Two control points keep the apex past the net.
        const path = `M ${COURT.you + 4} ${COURT.hit} C 30 -8, ${x - 10} -6, ${x} ${COURT.floor - 9}`;
        return (
          <button key={s} type="button" role="radio" aria-checked={value === s} className="fit-tile" disabled={disabled} onClick={() => onChange(s)}>
            <svg className="fit-court" viewBox={`0 0 ${COURT.w} ${COURT.h}`} aria-hidden="true">
              <line x1={COURT.you} y1={COURT.floor} x2={COURT.back} y2={COURT.floor} className="fit-court-floor" />
              <line x1={COURT.net} y1={COURT.floor - 12} x2={COURT.net} y2={COURT.floor} className="fit-court-net" />
              <line x1={COURT.you} y1={COURT.floor - 5} x2={COURT.you} y2={COURT.floor} className="fit-court-line" />
              <line x1={COURT.back} y1={COURT.floor - 5} x2={COURT.back} y2={COURT.floor} className="fit-court-line" />
              <path d={path} className="fit-court-path" />
              {/* The shuttle where it lands: cork down, feathers up. */}
              <g transform={`translate(${x} ${COURT.floor - 2})`} className="fit-court-shuttle">
                <path d="M -3.2 -6.5 L 3.2 -6.5 L 1.4 -1.2 L -1.4 -1.2 Z" />
                <circle cx="0" cy="0" r="1.6" />
              </g>
              <text x={COURT.you} y={COURT.h - 2} className="fit-court-label">{t('courtYou')}</text>
              <text x={COURT.net} y={COURT.h - 2} textAnchor="middle" className="fit-court-label">{t('courtNet')}</text>
              <text x={COURT.back} y={COURT.h - 2} textAnchor="end" className="fit-court-label">{t('courtBack')}</text>
            </svg>
            <span className="fit-tile-label">{t(`swing_${s}`)}</span>
            <span className="fit-tile-desc">{t(`swingDesc_${s}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Where everyone stands, top-down: our half on the left of the net (x 60),
 *  the other side on the right. `you` is drawn in the accent, `mate` muted,
 *  `them` faint. */
const STANDS: Record<FitPlayStyle, { you: [number, number]; mate?: [number, number]; them: [number, number][] }> = {
  doubles: { you: [28, 18], mate: [28, 38], them: [[88, 18], [88, 38]] },
  singles: { you: [30, 28], them: [[90, 28]] },
  mixed_front: { you: [50, 28], mate: [18, 28], them: [[70, 28], [102, 28]] },
  mixed_back: { you: [18, 28], mate: [50, 28], them: [[70, 28], [102, 28]] },
  // Never offered (see FIT_PLAY_STYLE_CHOICES); here so the record is total.
  mixed: { you: [30, 28], them: [] },
  any: { you: [30, 28], them: [] },
};

/**
 * "Mostly you play" as five tiles, each a court from above with you on it
 * (Grant, Stats canvas, 2026-10-20: "does it have to be a pill?"). Mixed is
 * split by where you stand, front or back, because that is the half of mixed
 * that changes what a racket should do. All-around spans the row.
 */
export function PlayStylePicker({ value, onChange, disabled, label }: PickerProps<FitPlayStyle>) {
  const t = useTranslations('stats.gear.fitPage');
  return (
    <div className="fit-tiles fit-tiles--2" role="radiogroup" aria-label={label}>
      {FIT_PLAY_STYLE_CHOICES.map((s) => {
        const st = STANDS[s];
        const wide = s === 'any';
        return (
          <button key={s} type="button" role="radio" aria-checked={value === s} className={`fit-tile${wide ? ' fit-tile--wide' : ''}`} disabled={disabled} onClick={() => onChange(s)}>
            <svg className="fit-court-top" viewBox="0 0 120 56" aria-hidden="true">
              <rect x="4" y="4" width="112" height="48" rx="2" className="fit-court-top-floor" />
              {wide && <rect x="4" y="4" width="56" height="48" className="fit-court-top-half" />}
              <path d="M4 9 H116 M4 47 H116 M46 4 V52 M74 4 V52" className="fit-court-top-line" />
              {s === 'singles' && <path d="M4 9 H60 M4 47 H60" className="fit-court-top-singles" />}
              <line x1="60" y1="1" x2="60" y2="55" className="fit-court-net" />
              {wide && <path d="M16 16 C30 6, 50 10, 50 28 C50 46, 26 50, 16 40" className="fit-court-path" />}
              {st.them.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3.5" className="fit-dot-them" />)}
              {st.mate && <circle cx={st.mate[0]} cy={st.mate[1]} r="4.5" className="fit-dot-mate" />}
              <circle cx={st.you[0]} cy={st.you[1]} r="5" className="fit-dot-you" />
            </svg>
            <span className="fit-tile-text">
              <span className="fit-tile-label">{t(`style_${s}`)}</span>
              <span className="fit-tile-desc">{t(`styleDesc_${s}`)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The circumference stamped on the cone, per size. */
const GRIP_MM: Record<FitGrip, number> = { G3: 89, G4: 83, G5: 76, G6: 70 };
/** The size most rackets are sold in (North America; G4 in much of Asia), so
 *  someone who has never checked has an obvious pick. */
const STANDARD_GRIP: FitGrip = 'G5';

/**
 * Grip size as the handle seen end-on, TO SCALE (44 / 38 / 32 / 26 px). The
 * circle sizes live in CSS (`.fit-grip-circle--G3` …) with `flex: 0 0 auto`
 * and `box-sizing: border-box`, which the handoff calls load-bearing: without
 * them the circles squash into ovals and the border inflates the small ones.
 * The STANDARD tag floats on the tile's top edge so it adds no height — inside
 * the tile it pushed G5's circle out of line with the other three.
 */
export function GripSizePicker({ value, onChange, disabled, label }: PickerProps<FitGrip>) {
  const t = useTranslations('stats.gear.fitPage');
  return (
    <div className="fit-tiles fit-tiles--4" role="radiogroup" aria-label={label}>
      {FIT_GRIPS.map((g) => (
        <button key={g} type="button" role="radio" aria-checked={value === g} className="fit-tile fit-grip-tile" disabled={disabled} onClick={() => onChange(g)}>
          {g === STANDARD_GRIP && <span className="fit-grip-standard">{t('gripStandard')}</span>}
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
