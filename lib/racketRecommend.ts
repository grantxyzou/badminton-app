import type { CatalogItem } from './types';
import type { PlayerProfile } from './racketProfile';

export interface Recommendation {
  item: CatalogItem;
  /** 0-100, normalized against the maximum weighted score. */
  score: number;
  reasons: string[];
  warnings: string[];
}

const FLEX_DEMAND: Record<string, number> = {
  Flexible: 1, Medium: 2, 'Medium-Stiff': 3, Stiff: 4, 'Extra Stiff': 5,
};

/** Flex is weighted highest because the wrong flex causes injury and
 *  frustration, not merely a mediocre match. Weights are the Python's. */
const WEIGHTS = {
  flex: 1.4, balance: 1.3, category: 1.2, format: 1.2,
  skillTier: 1.1, weight: 1.0, budget: 0.9,
};

/** Fields the scorers read. A row missing any of them cannot be scored
 *  honestly, so it is skipped rather than defaulted (spec D4). */
function isScorable(item: CatalogItem): boolean {
  const a = item.attributes ?? {};
  return typeof a.balance === 'string' && typeof a.flex === 'string' && typeof a.tier === 'string';
}

interface ScoreResult {
  score: number;
  reasons: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Derived profile values (mirrors the Python's PlayerProfile @property methods)
// ---------------------------------------------------------------------------

function technical(p: PlayerProfile): number {
  return (p.serves + p.net_play + p.clears + p.drops + p.drives + p.smashes + p.grip) / 7;
}

function physical(p: PlayerProfile): number {
  return (p.footwork + p.court_coverage + p.stamina) / 3;
}

function mental(p: PlayerProfile): number {
  return (p.game_reading + p.consistency + p.rules + p.mindset) / 4;
}

function overall(p: PlayerProfile): number {
  return (technical(p) + physical(p) + mental(p)) / 3;
}

function skillLevel(p: PlayerProfile): 'Beginner' | 'Intermediate' | 'Advanced' {
  const o = overall(p);
  if (o < 2.5) return 'Beginner';
  if (o < 3.75) return 'Intermediate';
  return 'Advanced';
}

function powerBias(p: PlayerProfile): number {
  const powerSide = (p.smashes + p.clears) / 2;
  const speedSide = (p.drives + p.net_play) / 2;
  return powerSide - speedSide;
}

// ---------------------------------------------------------------------------
// Scorers
// ---------------------------------------------------------------------------

// Consistency + grip technique determine how much stiffness a player can use.
function maxFlexDemand(p: PlayerProfile): number {
  const technique = (p.consistency + p.grip + p.smashes) / 3;
  if (technique <= 2.0) return 2; // Medium at most
  if (technique <= 3.0) return 3; // Medium-Stiff at most
  if (technique <= 4.0) return 4; // Stiff at most
  return 5; // anything
}

function scoreFlex(item: CatalogItem, p: PlayerProfile): ScoreResult {
  const flex = String(item.attributes!.flex);
  const demand = FLEX_DEMAND[flex] ?? 3;
  const ceiling = maxFlexDemand(p);
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (demand > ceiling) {
    const gap = demand - ceiling;
    warnings.push(
      `${flex} shaft is demanding for your current consistency (${p.consistency}/5) — mishits will feel harsh`
    );
    return { score: -8.0 * gap, reasons, warnings };
  }

  if (demand === ceiling) {
    reasons.push(`${flex} shaft matches your technique level`);
    return { score: 10.0, reasons, warnings };
  }

  if (demand === ceiling - 1) {
    reasons.push(`${flex} shaft gives you comfortable headroom`);
    return { score: 7.0, reasons, warnings };
  }

  // Much softer than the player can handle — usable but they'll outgrow it
  return { score: 3.0, reasons, warnings };
}

function scoreBalance(item: CatalogItem, p: PlayerProfile): ScoreResult {
  const bal = String(item.attributes!.balance);
  const bias = powerBias(p);
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (bias >= 0.5) {
    // power-oriented player
    if (bal === 'Head-heavy') {
      reasons.push(`Head-heavy suits your power game (smash ${p.smashes}/5, clears ${p.clears}/5)`);
      return { score: 10.0, reasons, warnings };
    }
    if (bal === 'Even') return { score: 5.0, reasons, warnings };
    return { score: 1.0, reasons, warnings };
  }

  if (bias <= -0.5) {
    // speed-oriented player
    if (bal === 'Head-light') {
      reasons.push(`Head-light suits your fast game (drives ${p.drives}/5, net ${p.net_play}/5)`);
      return { score: 10.0, reasons, warnings };
    }
    if (bal === 'Even') return { score: 5.0, reasons, warnings };
    return { score: 1.0, reasons, warnings };
  }

  // balanced player
  if (bal === 'Even') {
    reasons.push('Even balance suits your all-round game');
    return { score: 10.0, reasons, warnings };
  }
  return { score: 6.0, reasons, warnings };
}

function scoreWeight(item: CatalogItem, p: PlayerProfile): ScoreResult {
  const wmax = typeof item.attributes!.weightMaxG === 'number' ? (item.attributes!.weightMaxG as number) : 85;
  const endurance = (p.stamina + p.footwork) / 2;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (endurance <= 2.5) {
    if (wmax <= 84) {
      reasons.push("Lighter frame won't fatigue you over long sessions");
      return { score: 10.0, reasons, warnings };
    }
    warnings.push(
      `At up to ${Math.trunc(wmax)}g this may tire your arm (stamina ${p.stamina}/5, footwork ${p.footwork}/5)`
    );
    return { score: -3.0, reasons, warnings };
  }

  if (endurance >= 4.0) {
    // strong player can handle anything; slight nod to heavier for power
    return { score: wmax >= 85 ? 8.0 : 6.0, reasons, warnings };
  }

  return { score: wmax <= 88 ? 7.0 : 4.0, reasons, warnings };
}

function scoreCategory(item: CatalogItem, p: PlayerProfile): ScoreResult {
  const cat = String(item.attributes!.playStyle);
  const reasons: string[] = [];
  const warnings: string[] = [];

  const scores: Record<string, number> = {
    Power: (p.smashes + p.clears) / 2,
    Speed: (p.drives + p.net_play) / 2,
    Control: (p.drops + p.grip + p.game_reading) / 3,
    'All-round': technical(p),
  };
  const keys = Object.keys(scores);
  let best = keys[0];
  for (const k of keys) {
    if (scores[k] > scores[best]) best = k;
  }
  const spread = Math.max(...Object.values(scores)) - Math.min(...Object.values(scores));

  if (spread < 0.6) {
    // No clear strength — all-round is the safe call
    if (cat === 'All-round') {
      reasons.push('All-round frame fits your balanced skill profile');
      return { score: 10.0, reasons, warnings };
    }
    return { score: 6.0, reasons, warnings };
  }

  if (cat === best) {
    reasons.push(`${cat} frame amplifies your strongest area (${scores[best].toFixed(1)}/5)`);
    return { score: 10.0, reasons, warnings };
  }
  if (cat === 'All-round') return { score: 6.0, reasons, warnings };
  return { score: 3.0, reasons, warnings };
}

function scoreFormat(item: CatalogItem, p: PlayerProfile): ScoreResult {
  const sub = item.attributes!.subType;
  const bal = String(item.attributes!.balance);
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (p.format === 'doubles') {
    if (sub === 'doubles') {
      reasons.push('Purpose-built for doubles');
      return { score: 10.0, reasons, warnings };
    }
    if (bal === 'Head-light') {
      reasons.push("Head-light frames excel in doubles' fast exchanges");
      return { score: 8.0, reasons, warnings };
    }
    if (bal === 'Even') return { score: 5.0, reasons, warnings };
    return { score: 2.0, reasons, warnings };
  }

  if (p.format === 'singles') {
    if (bal === 'Head-heavy') {
      reasons.push("Head-heavy suits singles' rear-court rallies");
      return { score: 9.0, reasons, warnings };
    }
    if (bal === 'Even') {
      reasons.push("Even balance handles singles' varied court positions");
      return { score: 7.0, reasons, warnings };
    }
    return { score: 4.0, reasons, warnings };
  }

  // "both" — reward versatility
  if (bal === 'Even' || sub === 'all-round' || item.attributes!.playStyle === 'All-round') {
    reasons.push('Versatile enough for both singles and doubles');
    return { score: 9.0, reasons, warnings };
  }
  return { score: 6.0, reasons, warnings };
}

const SKILL_TIER_FIT: Record<string, number> = {
  'Beginner|Entry-level': 10.0,
  'Beginner|Mid-range': 5.0,
  'Beginner|Premium': -5.0,
  'Intermediate|Entry-level': 4.0,
  'Intermediate|Mid-range': 10.0,
  'Intermediate|Premium': 7.0,
  'Advanced|Entry-level': 0.0,
  'Advanced|Mid-range': 6.0,
  'Advanced|Premium': 10.0,
};

function scoreSkillTier(item: CatalogItem, p: PlayerProfile): ScoreResult {
  const tier = String(item.attributes!.tier);
  const level = skillLevel(p);
  const reasons: string[] = [];
  const warnings: string[] = [];

  const score = SKILL_TIER_FIT[`${level}|${tier}`] ?? 5.0;

  if (score >= 10.0) {
    reasons.push(`${tier} tier matches your ${level.toLowerCase()} skill level`);
  } else if (score < 0) {
    warnings.push(`${tier} frames are unforgiving at ${level.toLowerCase()} level`);
  }

  return { score, reasons, warnings };
}

function scoreBudget(item: CatalogItem, p: PlayerProfile): ScoreResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (p.budgetMaxCad == null) return { score: 5.0, reasons, warnings };
  if (item.msrp == null) return { score: 5.0, reasons, warnings };

  const budget = p.budgetMaxCad;
  // Reward rackets using 60-100% of budget (getting value without overspending)
  const ratio = item.msrp / budget;
  if (ratio > 1.0) return { score: -20.0, reasons, warnings }; // over budget, effectively excluded
  if (ratio >= 0.6) {
    reasons.push(`Good use of your $${Math.trunc(budget)} budget`);
    return { score: 10.0, reasons, warnings };
  }
  if (ratio >= 0.35) return { score: 7.0, reasons, warnings };
  return { score: 4.0, reasons, warnings }; // very cheap relative to budget
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function scoreItem(item: CatalogItem, p: PlayerProfile): Recommendation {
  let total = 0;
  const allReasons: string[] = [];
  const allWarnings: string[] = [];

  const scorers: Array<[keyof typeof WEIGHTS, (i: CatalogItem, p: PlayerProfile) => ScoreResult]> = [
    ['flex', scoreFlex],
    ['balance', scoreBalance],
    ['weight', scoreWeight],
    ['category', scoreCategory],
    ['format', scoreFormat],
    ['skillTier', scoreSkillTier],
    ['budget', scoreBudget],
  ];

  for (const [name, fn] of scorers) {
    const { score, reasons, warnings } = fn(item, p);
    total += score * WEIGHTS[name];
    allReasons.push(...reasons);
    allWarnings.push(...warnings);
  }

  const maxPossible = Object.values(WEIGHTS).reduce((sum, w) => sum + 10.0 * w, 0);
  const normalised = Math.round((Math.max(0, total) / maxPossible) * 100 * 10) / 10;

  return { item, score: normalised, reasons: allReasons, warnings: allWarnings };
}

/**
 * Return the topN items of `category` for this player, best first.
 * Pure: no fetch/DB/clock/randomness. Excludes non-matching categories,
 * rows missing normalized fields (spec D4), and the player's current racket.
 * Never hard-filters on budget (spec D6) — an over-budget racket sinks via
 * scoreBudget's -20 penalty but stays in the results.
 *
 * `category` defaults to 'racket' so every existing call site is unchanged.
 * The scorers themselves remain racket-shaped — this parameter exists so the
 * filter is not a lie, not because other categories are scorable yet.
 */
export function recommendRackets(
  profile: PlayerProfile,
  catalog: CatalogItem[],
  topN: number = 5,
  category: CatalogItem['category'] = 'racket'
): Recommendation[] {
  const results: Recommendation[] = [];

  for (const item of catalog) {
    if (item.category !== category) continue;
    if (!isScorable(item)) continue;
    if (profile.currentRacketId && item.id === profile.currentRacketId) continue;

    results.push(scoreItem(item, profile));
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}
