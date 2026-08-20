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
