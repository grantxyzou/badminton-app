/**
 * String tension advice.
 *
 * ADVISORY, NOT A SPEC. The number is a starting point for a conversation with
 * whoever strings the racket, not an instruction — which is why it ships with
 * its own copy key rather than being rendered as a bare figure. Real tension
 * depends on string type, racket, stringing machine and how hard someone
 * actually hits, none of which the app knows.
 *
 * Deterministic and offline: no API, no clock, no randomness. Same level and
 * format always give the same answer, so two members comparing screens see a
 * consistent story.
 */

export type PlayFormat = 'singles' | 'doubles' | 'both';

export const MIN_LB = 20;
export const MAX_LB = 30;

export interface TensionAdvice {
  lb: number;
  /** 0-1 position along the MIN_LB..MAX_LB scale, for the knob. */
  position: number;
  /** i18n key suffix for the explanatory sentence. */
  reasonKey: 'lowLevel' | 'midLevel' | 'highLevel';
}

/**
 * `round(21 + level)`, plus 2 for singles, clamped to [20, 30].
 *
 * Higher level → higher tension because control matters more than the power a
 * loose bed gives you for free; singles adds a couple of pounds because the
 * shot that decides a singles rally is usually a precise one. `both` is
 * treated as doubles: it is the default this club actually plays, and the
 * lower number is the safer thing to hand someone who has not chosen.
 */
export function recommendTension(level: number | null, format: PlayFormat): TensionAdvice | null {
  // No level yet means no advice. Defaulting to a mid number would be
  // inventing a recommendation out of nothing.
  if (level === null || !Number.isFinite(level)) return null;

  const singles = format === 'singles';
  const raw = Math.round(21 + level) + (singles ? 2 : 0);
  const lb = Math.max(MIN_LB, Math.min(MAX_LB, raw));

  return {
    lb,
    position: (lb - MIN_LB) / (MAX_LB - MIN_LB),
    reasonKey: level < 2.5 ? 'lowLevel' : level < 4 ? 'midLevel' : 'highLevel',
  };
}

/** `both` selects Doubles in the UI and writes through on change. */
export function formatForToggle(format: PlayFormat | undefined): 'singles' | 'doubles' {
  return format === 'singles' ? 'singles' : 'doubles';
}

/**
 * `${label} · NN lb` once a strung item's tension is on record, the bare
 * label otherwise — never a placeholder number for a string nobody has
 * logged the tension of yet. Shared by `YourKitCard` (the row) and `BagList`
 * (the same item, inside the sheet where a member would look to confirm the
 * tension actually landed) so the two surfaces can't drift into disagreeing
 * about the one item they're both describing. `lbSuffix` is the translated
 * unit string ("lb" / "磅") so this stays presentation-agnostic — callers
 * pass their own `t('lb')`.
 */
export function gearItemLabel(item: { category: string; label: string; tensionLbs?: number }, lbSuffix: string): string {
  if (item.category === 'string' && typeof item.tensionLbs === 'number') {
    return `${item.label} · ${item.tensionLbs} ${lbSuffix}`;
  }
  return item.label;
}

/**
 * A racket's rated window from its catalog attributes, or null when the row
 * prints neither bound. Many frames print only a ceiling, and one prints only
 * a floor; the missing side is the app's own scale. The ONE definition — the
 * tension field clamps to it and the fit verdict's range sits inside it, and a
 * member sees both.
 */
export function ratedRange(attributes: Record<string, unknown> | undefined): [number, number] | null {
  const hi = attributes?.tensionMaxLbs;
  const lo = attributes?.tensionMinLbs;
  if (typeof hi !== 'number' && typeof lo !== 'number') return null;
  const window: [number, number] = [typeof lo === 'number' ? lo : MIN_LB, typeof hi === 'number' ? hi : MAX_LB];
  return window[0] <= window[1] ? window : null;
}

/** Where a tension sits on a scale, 0–1, clamped. The scale is the app's
 *  20–30 lb unless a chart has widened it to hold a figure past either end. */
export function scalePosition(lbs: number, lo: number = MIN_LB, hi: number = MAX_LB): number {
  return Math.max(0, Math.min(1, (lbs - lo) / (hi - lo)));
}

/**
 * The scale a tension ruler draws: the app's 20–30 lb, widened to hold every
 * figure on it (the member's, the rated window, the club's band) and rounded
 * out to even pounds so the middle tick is a whole number. Members do string
 * past 30, and a fixed scale pinned their line to the end while they typed.
 */
export function rulerScale(figures: Array<number | null | undefined>): [number, number] {
  const nums = figures.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const lo = Math.min(MIN_LB, ...nums);
  const hi = Math.max(MAX_LB, ...nums);
  return [Math.floor(lo / 2) * 2, Math.ceil(hi / 2) * 2];
}
