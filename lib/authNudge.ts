/**
 * Should this member be nudged to add a stronger sign-in method?
 *
 * Pure, so the policy is testable without a database — and so the policy is
 * stated in ONE place rather than being re-derived by the card, the sheet and
 * the API separately, which is how three surfaces end up disagreeing about
 * whether someone has already been asked.
 *
 * The product decision this encodes (2026-08-26): the PIN is NOT being retired.
 * Nobody is ever locked out of a badminton game over their auth method, so this
 * is a nudge and never a gate.
 */
export const NUDGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface NudgeInput {
  hasPin: boolean;
  hasPassword: boolean;
  linkedCount: number;
  /** ISO timestamp of the last dismissal, or null if never dismissed. */
  dismissedAt: string | null;
  /** Injectable for tests. Defaults to now. */
  now?: number;
}

export function shouldNudgeUpgrade(input: NudgeInput): boolean {
  // Nothing to upgrade FROM. An account with no PIN at all is either brand new
  // (and arrived via a modern method anyway) or anonymous — neither wants this.
  if (!input.hasPin) return false;

  // Already has something modern. Hide permanently, not on a cooldown: the
  // nudge has done its job and re-asking would be nagging.
  if (input.hasPassword || input.linkedCount > 0) return false;

  if (!input.dismissedAt) return true;

  const dismissed = Date.parse(input.dismissedAt);
  // An unparseable timestamp is treated as "never dismissed" rather than
  // "dismissed forever" — the failure mode of a corrupt value should be one
  // extra prompt, not a silently disabled feature.
  if (Number.isNaN(dismissed)) return true;

  return (input.now ?? Date.now()) - dismissed >= NUDGE_COOLDOWN_MS;
}
