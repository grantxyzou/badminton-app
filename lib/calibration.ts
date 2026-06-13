/**
 * Elo-lite game calibration — turns logged game results into an OBSERVED level
 * (1–5) per player, on the same scale as the self-assessment so the two can be
 * compared and blended (see `lib/level.ts`).
 *
 * Pure + deterministic (replay the same games + seeds → the same ratings), so it
 * unit-tests directly and runs on read. No decay, no stored rating doc: the
 * evidence's recency lives in the BLEND WEIGHT (`w_game` ramps with game count),
 * not in the rating itself.
 *
 * Why this isn't circular at a 6–10 player scale: every player is SEEDED at
 * their own self-assessment (`CalSeed.selfLevel`), which anchors the absolute
 * scale. Games then nudge players relative to that anchor. A mis-seeded newcomer
 * still perturbs the group (critique E) — a known, accepted limitation at this N;
 * the seed anchoring is the mitigation actually in place. Provisional players
 * (<8 games) move fast on their OWN rating (K=0.12).
 *
 * Doubles: both partners on a team receive the identical delta (individual
 * attribution-splitting is over-engineering at this volume). The per-game delta
 * is intentionally NEVER surfaced in the UI — only the slow-moving blended level
 * is — so a "I dropped after carrying that game" moment never lands (critique D).
 */

export interface CalGame {
  teamA: string[];
  teamB: string[];
  scoreA: number;
  scoreB: number;
  loggedAt: string;
}

export interface CalSeed {
  nameLower: string;
  /** Latest self-assessment overall (1–5), or null → DEFAULT_SEED. */
  selfLevel: number | null;
}

export interface PlayerCalibration {
  nameLower: string;
  observedLevel: number;
  games: number;
  wins: number;
  provisional: boolean;
  lastGameAt: string | null;
}

export const ELO = {
  DIVISOR: 2.0,            // one full level apart ⇒ ~76% expectancy
  K_PROVISIONAL: 0.12,
  K_STABLE: 0.06,
  PROVISIONAL_GAMES: 8,
  MARGIN_MIN: 0.5,
  MARGIN_MAX: 1.5,
  DEFAULT_SEED: 2.6,      // switch-phase boundary — the neutral middle
  WINDOW_DAYS: 365,
} as const;

const clampLevel = (n: number) => Math.min(5, Math.max(1, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

function ageDays(fromIso: string, nowIso: string): number {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(from) || Number.isNaN(now)) return Number.POSITIVE_INFINITY;
  return (now - from) / 86_400_000;
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : ELO.DEFAULT_SEED;
}

/**
 * Fold the group's games chronologically into observed levels. `seeds` anchor
 * the absolute scale; any name appearing in a game without a seed starts at
 * DEFAULT_SEED. Returns a map keyed by lowercased name.
 */
export function calibrateRatings(games: CalGame[], seeds: CalSeed[], now: string): Map<string, PlayerCalibration> {
  const rating = new Map<string, number>();
  const count = new Map<string, number>();
  const wins = new Map<string, number>();
  const lastAt = new Map<string, string>();

  for (const s of seeds) rating.set(s.nameLower, clampLevel(s.selfLevel ?? ELO.DEFAULT_SEED));

  const norm = (team: string[]) => team.map((n) => n.trim().toLowerCase()).filter(Boolean);
  const ensure = (name: string) => {
    if (!rating.has(name)) rating.set(name, ELO.DEFAULT_SEED);
  };

  const inWindow = games
    .filter((g) => Array.isArray(g.teamA) && Array.isArray(g.teamB) && typeof g.loggedAt === 'string')
    .filter((g) => ageDays(g.loggedAt, now) <= ELO.WINDOW_DAYS)
    .slice()
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));

  for (const g of inWindow) {
    const a = norm(g.teamA);
    const b = norm(g.teamB);
    if (a.length === 0 || b.length === 0) continue;
    [...a, ...b].forEach(ensure);

    const rA = mean(a.map((n) => rating.get(n)!));
    const rB = mean(b.map((n) => rating.get(n)!));
    const eA = 1 / (1 + Math.pow(10, (rB - rA) / ELO.DIVISOR));
    const eB = 1 - eA;

    const sA = g.scoreA > g.scoreB ? 1 : g.scoreA < g.scoreB ? 0 : 0.5;
    const sB = 1 - sA;
    const margin = Math.min(ELO.MARGIN_MAX, Math.max(ELO.MARGIN_MIN, 0.5 + Math.abs(g.scoreA - g.scoreB) / 12));

    const apply = (team: string[], s: number, e: number) => {
      for (const n of team) {
        const k = (count.get(n) ?? 0) < ELO.PROVISIONAL_GAMES ? ELO.K_PROVISIONAL : ELO.K_STABLE;
        rating.set(n, clampLevel(rating.get(n)! + k * margin * (s - e)));
        count.set(n, (count.get(n) ?? 0) + 1);
        lastAt.set(n, g.loggedAt);
      }
      // Wins tracked separately so we don't conflate with the rating update loop.
      if (s === 1) for (const n of team) wins.set(n, (wins.get(n) ?? 0) + 1);
    };
    apply(a, sA, eA);
    apply(b, sB, eB);
  }

  const out = new Map<string, PlayerCalibration>();
  for (const [nameLower, games_] of count.entries()) {
    out.set(nameLower, {
      nameLower,
      observedLevel: round2(rating.get(nameLower)!),
      games: games_,
      wins: wins.get(nameLower) ?? 0,
      provisional: games_ < ELO.PROVISIONAL_GAMES,
      lastGameAt: lastAt.get(nameLower) ?? null,
    });
  }
  return out;
}

export interface BlindSpot {
  /** observed − self (signed). Never rendered as a raw number for 'below'. */
  delta: number;
  direction: 'above' | 'below';
}

/**
 * The self-vs-observed gap, asymmetrically gated (locked decision: opt-in +
 * asymmetric). A pleasant "you're playing ABOVE your check-in" surfaces readily
 * (≥0.4 over ≥8 games); the deflating "below" side is rarer and gentler (≥0.6
 * over ≥12 games) and its caller must never print the deficit number. Returns
 * null when there isn't enough evidence to say anything.
 */
export function blindSpot(
  selfLevel: number | null,
  cal: { observedLevel: number; games: number } | null | undefined,
): BlindSpot | null {
  if (selfLevel === null || !cal || cal.games < ELO.PROVISIONAL_GAMES) return null;
  const delta = round2(cal.observedLevel - selfLevel);
  if (delta >= 0.4) return { delta, direction: 'above' };
  if (delta <= -0.6 && cal.games >= 12) return { delta, direction: 'below' };
  return null;
}
