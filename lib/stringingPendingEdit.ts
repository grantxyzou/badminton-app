import type { PlayerPendingEdit, StringingJob } from '@/lib/types';

/**
 * The proposed-change diff a player is shown, or null.
 *
 * Both figures are exact dollars, like the quote. Nothing is emitted unless a
 * proposal is outstanding, and each field appears only if that field is
 * actually changing.
 *
 * Note what is NOT here: `proposedBy`. A player is told the club changed
 * something, not which volunteer typed it.
 */
export function toPlayerPendingEdit(job: StringingJob): PlayerPendingEdit | null {
  const p = job.pendingEdit;
  if (!p) return null;
  const out: PlayerPendingEdit = { proposedAt: p.proposedAt };
  if (p.racketLabel !== undefined) {
    out.racketFrom = job.racketLabel;
    out.racketTo = p.racketLabel;
  }
  if (p.stringLabel !== undefined) {
    out.stringFrom = job.stringLabel;
    out.stringTo = p.stringLabel;
  }
  if (p.tensionMains !== undefined || p.tensionCrosses !== undefined) {
    out.tensionFrom = `${job.tensionMains}/${job.tensionCrosses}`;
    out.tensionTo = `${p.tensionMains ?? job.tensionMains}/${p.tensionCrosses ?? job.tensionCrosses}`;
  }
  if (p.priceCents !== undefined) {
    out.priceFrom = job.priceCents === null ? null : job.priceCents / 100;
    out.priceTo = p.priceCents === null ? null : p.priceCents / 100;
  }
  // The stringer's "why", when they gave one. Words, not money fields, so it
  // rides the stringer's projection too — but only beside a spec change (see
  // `stringerPendingEdit` in app/api/stringing/jobs/route.ts).
  if (p.reason) out.reason = p.reason;
  return out;
}
