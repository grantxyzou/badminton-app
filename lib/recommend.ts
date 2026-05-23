import type { CatalogItem } from '@/lib/types';

/**
 * Deterministic racket recommendation for Value-Hub Slice-0.
 *
 * Decision (2026-05-22): when `stage` is undefined — the common case, since
 * `Member.stage` is optional and rarely set — fall back to the widest-range
 * "all-rounder" racket so the card always shows something. Stage-aware fit
 * only applies once a member has a stage. No AI here (plan Decision B2).
 *
 * Pure: given inputs, returns the same racket every time. Unit-tested.
 */
export function recommendRacket(input: {
  stage?: number;
  /** Member's recent games-played count — minor tiebreak signal. */
  gamesPlayed?: number;
  catalog: CatalogItem[];
}): CatalogItem | null {
  const rackets = input.catalog.filter((c) => c.category === 'racket');
  if (rackets.length === 0) return null;

  const stage = input.stage;
  const span = (r: CatalogItem) => r.skillRange[1] - r.skillRange[0];
  const center = (r: CatalogItem) => (r.skillRange[0] + r.skillRange[1]) / 2;

  let eligible = rackets;
  if (typeof stage === 'number') {
    const inRange = rackets.filter((r) => stage >= r.skillRange[0] && stage <= r.skillRange[1]);
    // Never strand the user with an empty card — fall back to all rackets.
    eligible = inRange.length > 0 ? inRange : rackets;
  }

  const investedPlayer = (input.gamesPlayed ?? 0) >= 8;

  const sorted = [...eligible].sort((a, b) => {
    if (typeof stage === 'number') {
      // Closest-centered fit first.
      const fit = Math.abs(stage - center(a)) - Math.abs(stage - center(b));
      if (fit !== 0) return fit;
    } else {
      // No stage: widest span = most all-rounder.
      const bySpan = span(b) - span(a);
      if (bySpan !== 0) return bySpan;
    }
    // Invested players skew premium; newcomers skew affordable.
    const am = a.msrp ?? 0;
    const bm = b.msrp ?? 0;
    const byPrice = investedPlayer ? bm - am : am - bm;
    if (byPrice !== 0) return byPrice;
    // Final deterministic tiebreak.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted[0] ?? null;
}

/**
 * Partner-frequency from co-attendance. For each session the viewer attended,
 * every OTHER attendee gets +1. Pure; case-insensitive on the viewer name;
 * preserves the first-seen display casing of each partner.
 */
export function topPartners(input: {
  me: string;
  sessions: { sessionId: string; names: string[] }[];
  limit?: number;
}): { name: string; count: number }[] {
  const meLower = input.me.trim().toLowerCase();
  const counts = new Map<string, { name: string; count: number }>();

  for (const session of input.sessions) {
    const attended = session.names.some((n) => n.trim().toLowerCase() === meLower);
    if (!attended) continue;
    for (const raw of session.names) {
      const lower = raw.trim().toLowerCase();
      if (lower === meLower) continue;
      const prior = counts.get(lower);
      if (prior) prior.count += 1;
      else counts.set(lower, { name: raw.trim(), count: 1 });
    }
  }

  const out = [...counts.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
  });
  return typeof input.limit === 'number' ? out.slice(0, input.limit) : out;
}
