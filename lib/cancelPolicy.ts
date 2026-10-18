/**
 * The late-cancellation rule (docs/plans/late-cancel-fee.md), pure.
 *
 * A club may set `groups.settings.lateCancelHours`: whole hours, 1–168. With
 * it set, a player cancelling their own confirmed spot inside that many hours
 * of the session's start is warned that a fee may apply and must confirm, and
 * the cancellation is stamped late for the admin. Nothing here moves money.
 *
 * `DELETE /api/players` is the only caller. It asks after it has verified who
 * is cancelling, so this module never sees an unauthenticated request.
 */

export const LATE_CANCEL_MIN_HOURS = 1;
export const LATE_CANCEL_MAX_HOURS = 168;
const HOUR_MS = 3_600_000;

/** Whole hours, 1–168. The only values the admin settings route will store. */
export function isValidLateCancelHours(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= LATE_CANCEL_MIN_HOURS && value <= LATE_CANCEL_MAX_HOURS;
}

/** The club's window, or `null` when the policy is off — absent, missing or corrupt all read as off. */
export function lateCancelHoursOf(settings: { lateCancelHours?: unknown } | null | undefined): number | null {
  const v = settings?.lateCancelHours;
  return isValidLateCancelHours(v) ? v : null;
}

export interface LateCancelVerdict {
  late: boolean;
  /** Whole hours before the start, clamped at 0 once it has begun; `null` without a usable start time. */
  hoursBefore: number | null;
}

/**
 * Whether a cancel at `nowMs` is late for a session starting at `startIso`.
 *
 * Late means STRICTLY inside the window: exactly 48 hours out is not late. A
 * session already under way is late (a no-show by another name). No start
 * time, or a policy that is off, is never late — the rule only ever adds a
 * step when it can say why.
 */
export function lateCancelVerdict(startIso: string | undefined, nowMs: number, policyHours: number | null): LateCancelVerdict {
  const start = typeof startIso === 'string' ? Date.parse(startIso) : NaN;
  if (!Number.isFinite(start)) return { late: false, hoursBefore: null };
  const msBefore = start - nowMs;
  const hoursBefore = Math.max(0, Math.floor(msBefore / HOUR_MS));
  const late = policyHours !== null && msBefore < policyHours * HOUR_MS;
  return { late, hoursBefore };
}
