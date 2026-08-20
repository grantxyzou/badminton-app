/**
 * Club-comparison privacy — the member's single master switch for whether
 * Stats shows where their skills sit against the rest of the club.
 *
 * Design decisions this encodes (from the Stats v2 handoff):
 *
 *  - ONE switch, not one per skill or per surface. A finer control would imply
 *    the ratings leave the member's account, which they never do.
 *  - Asked ONCE, the first time Stats would actually show a comparison — not at
 *    sign-up, where it is one more thing between a player and the court.
 *  - Default ON. Defensible only because the comparison is bands, self-reported,
 *    and reveals nothing to anyone else.
 *  - NOT reciprocal. Opting out hides the member's own band and nothing else —
 *    the club spread stays visible. There is no tit-for-tat to enforce, and
 *    taking the spread away would be a penalty for a privacy choice.
 */
export interface StatsPrivacy {
  /** Show this member their own band. Default true. */
  clubComparison: boolean;
  /** ISO timestamp of the first-run prompt. `null` = never asked. */
  promptedAt: string | null;
}

export const DEFAULT_STATS_PRIVACY: StatsPrivacy = {
  clubComparison: true,
  promptedAt: null,
};

/**
 * Read-tolerance for member docs written before this field existed.
 *
 * An absent field means NEVER ASKED, so it must normalize to
 * `promptedAt: null` — that is what makes existing members see the prompt once
 * rather than silently defaulting into a comparison they were never offered.
 * Do not "simplify" this to `?? DEFAULT` on the whole object without keeping
 * per-field tolerance: a partial doc (say, `clubComparison` written but
 * `promptedAt` missing) must still read as unasked.
 */
export function normalizeStatsPrivacy(raw: unknown): StatsPrivacy {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATS_PRIVACY };
  const obj = raw as Record<string, unknown>;
  return {
    clubComparison:
      typeof obj.clubComparison === 'boolean'
        ? obj.clubComparison
        : DEFAULT_STATS_PRIVACY.clubComparison,
    promptedAt: typeof obj.promptedAt === 'string' && obj.promptedAt ? obj.promptedAt : null,
  };
}

/**
 * THE CONSENT INVARIANT — the stored preference alone is not consent.
 *
 * A member's band may only be revealed once the prompt has been ANSWERED.
 * Deriving this from `clubComparison` alone is a real defect, not a style
 * nit: the default is `true`, so an unasked member's band would render behind
 * the consent sheet's semi-transparent backdrop — leaking the very answer the
 * sheet is asking for, and making "Keep it private" *take away* something they
 * had already been shown.
 *
 * Every surface that draws a filled band, a median tick, or a percentile
 * sentence must gate on this, never on `clubComparison`.
 */
export function isComparisonRevealed(privacy: StatsPrivacy): boolean {
  return privacy.clubComparison && privacy.promptedAt !== null;
}

/** True when the first-run consent sheet still owes the member a question. */
export function needsComparisonPrompt(privacy: StatsPrivacy): boolean {
  return privacy.promptedAt === null;
}

/**
 * Validate an incoming `statsPrivacy` patch. The client sends only the answer;
 * `promptedAt` is stamped server-side so a caller cannot forge "already asked"
 * to suppress the prompt on someone else's account.
 */
export function parseStatsPrivacyPatch(raw: unknown): { clubComparison: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.clubComparison !== 'boolean') return null;
  return { clubComparison: obj.clubComparison };
}
