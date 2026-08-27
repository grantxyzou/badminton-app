import type { CatalogItem } from './types';
import type { PlayerProfile } from './racketProfile';
import { overall, skillLevel } from './racketRecommend';

/**
 * Pairs a string to a RACKET, not to a player.
 *
 * The racket recommender amplifies — it fits the frame to the player. This
 * inverts that, because by the time we get here the frame is fixed and the
 * string is the smaller lever (~15-20% of felt performance against the frame's
 * ~80%). So the string's job is to COMPENSATE:
 *
 *   head-heavy power frame  -> the system already has power; give back
 *                              durability and control
 *   head-light speed frame  -> the system is power-deficient; give back
 *                              repulsion
 *
 * Ported from `docs/superpowers/reference/pair_racket_string.py`. Deviations
 * from that reference are numbered V1-V6 in
 * `docs/superpowers/specs/2026-08-20-string-pairing-design.md` and marked at
 * each site below. Everything else is deliberately verbatim, including the
 * magic numbers: the reference carries CALIBRATION NOTEs explaining what each
 * one was corrected FROM, and re-deriving them would destroy the property that
 * a reviewer can diff them against the source.
 */

/** Attributes are a loose `Record<string, string | number>`, so every read is
 *  a narrowing. Unknown degrades to the caller's default rather than throwing —
 *  a catalog row with an unseen label must not crash the rail. */
function num(item: CatalogItem, key: string, fallback: number): number {
  const v = item.attributes?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Free-text attribute read. Returns null rather than a default so callers
 *  decide what "unknown" means for their own scale. */
function text(item: CatalogItem, key: string): string | null {
  const v = item.attributes?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Brand free-text -> ordinal. Unknown falls to the caller's default rather
 *  than throwing, so an unseen label degrades instead of crashing the rail. */
function ordinal(label: string | null, table: Record<string, number>, fallback: number): number {
  if (!label) return fallback;
  return table[label.toLowerCase()] ?? fallback;
}

const BALANCE_SCALE: Record<string, number> = {
  'extra head-light': 1, 'head-light': 2, 'slightly head-light': 2.5,
  even: 3, 'even balance': 3, balanced: 3,
  'slightly head-heavy': 3.5, 'head-heavy': 4, 'extra head-heavy': 5,
};

const FLEX_SCALE: Record<string, number> = {
  flexible: 1, 'medium flexible': 2, 'medium flex': 2,
  medium: 3, 'medium stiff': 4, 'medium-stiff': 4,
  stiff: 5, 'extra stiff': 6, 'extra-stiff': 6,
};

const RACKET_CATEGORY_POWER: Record<string, number> = {
  Power: 1.5, 'All-round': 0.0, Control: -0.5, Speed: -1.0,
};

const STRING_CATEGORY_POWER: Record<string, number> = {
  Repulsion: 1.5, 'All-round': 0.0, Hybrid: -0.3, Control: -0.5, Durability: -1.0,
};

const SYSTEM_STRING_WEIGHT = 0.35;
const SYSTEM_FRAME_WEIGHT = 0.65;
const SKILL_MULTIPLIER_FLOOR = 0.25;

/**
 * V1 (scale bridge). The reference assumes the ACE matrix's 1-6 ratings; this
 * app rates 1-5 (`lib/assessment.ts`). Five ported constants depend on that —
 * `(overall - 3.5) * 0.07`, `(offense - 1) / 5`, the `consistency` divisor, and
 * the neutral-3 terms in `targetSystemPower`.
 *
 * Convert here instead of re-deriving them. The numbers come out the same
 * either way; what re-deriving would destroy is the ability to diff the
 * constants below against the reference file and see that they match.
 */
function toAceScale(v: number): number {
  return 1 + (v - 1) * 1.25;
}

/**
 * V2. The four dimensions the scorers use INDIVIDUALLY, on the reference's
 * 1-6 scale. `defence` and `serve` are omitted deliberately: the reference
 * reaches them only through its own six-dimension `overall`, which V2 replaces
 * with `racketRecommend`'s fourteen-skill `overall()` so that no rated skill is
 * silently dropped from the average.
 */
interface AceDims {
  offense: number;
  grip: number;
  movement: number;
  strategy: number;
  overall: number;
}

function aceDims(p: PlayerProfile): AceDims {
  const mean = (...xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    offense: toAceScale(mean(p.smashes, p.drives)),
    grip: toAceScale(p.grip),
    movement: toAceScale(mean(p.footwork, p.court_coverage)),
    strategy: toAceScale(mean(p.game_reading, p.rules, p.mindset)),
    overall: toAceScale(overall(p)),
  };
}

/**
 * 0-10, centred on 5. How much power the FRAME contributes before stringing.
 *
 * The usable band is deliberately 2-9, not 0-10: a head-light speed frame is
 * not a zero-power racket, and letting the ends clamp made every extreme frame
 * score identically, costing the ranking all its resolution at the top.
 */
function racketPowerIndex(racket: CatalogItem): number {
  const bal = ordinal(text(racket, 'balance'), BALANCE_SCALE, 3.0);
  const cat = RACKET_CATEGORY_POWER[text(racket, 'playStyle') ?? ''] ?? 0.0;
  const wmax = num(racket, 'weightMaxG', 84);
  const weightBonus = Math.max(-0.4, Math.min(0.8, (wmax - 84) / 8.0));
  const raw = 5.0 + (bal - 3.0) * 1.15 + cat * 0.7 + weightBonus;
  return Math.max(2.0, Math.min(9.0, raw));
}

/**
 * 0-10, centred on 5. How much power the STRING adds.
 *
 * Gauge's effect on power is TENSION-DEPENDENT. A thin string at 22 lbs is a
 * trampoline; the same string at 28 lbs is a precision instrument with a tiny
 * sweet spot. Treating thin as unconditionally powerful made the reference
 * recommend thick durability strings to advanced players on flagship frames —
 * the exact opposite of what they use. So the thinness term decays as tension
 * rises, and high tension applies a flat reduction on top.
 */
function stringPowerIndex(s: CatalogItem, tension: number | null): number {
  const gauge = num(s, 'gaugeMm', 0.66);
  const thinness = Math.max(-1.0, Math.min(1.0, (0.655 - gauge) / 0.065));
  const cat = STRING_CATEGORY_POWER[text(s, 'stringType') ?? ''] ?? 0.0;
  const rep = (num(s, 'repulsion', 7) - 7) / 3.0;

  const t = tension ?? 24.0;
  const over = Math.max(0.0, t - 24.0);
  const thinGain = Math.max(0.6, 2.2 - over * 0.2);
  const flat = -over * 0.26 + Math.max(0.0, 24.0 - t) * 0.2;

  const raw = 5.0 + thinness * thinGain + cat * 0.9 + rep * 1.1 + flat;
  return Math.max(2.0, Math.min(9.0, raw));
}

/** The system-power range this frame can reach across the whole string DB. */
function achievablePowerBand(racket: CatalogItem): [number, number] {
  const rp = racketPowerIndex(racket) * SYSTEM_FRAME_WEIGHT;
  return [rp + 2.0 * SYSTEM_STRING_WEIGHT, rp + 9.0 * SYSTEM_STRING_WEIGHT];
}

/**
 * Where in the frame's ACHIEVABLE band to aim, 0-1.
 *
 * Expressed as a fraction rather than an absolute 0-10 target because on a
 * head-heavy flagship the frame alone contributes ~5.0, so any absolute target
 * below that was unreachable and every string clipped to the low end.
 *
 * Responsiveness RISES mildly with skill. The reverse assumption ("strong
 * attacker wants less assist") is true of a club player and false of an
 * advanced one — elite players run thin, lively strings and control them with
 * tension and technique. Control is expressed through the tension placement,
 * not by de-tuning the bed.
 */
function targetPowerFraction(a: AceDims): number {
  let frac = 0.4 + (a.overall - 3.5) * 0.07;
  frac += (3 - a.offense) * 0.03;
  frac += (3 - a.strategy) * 0.015;
  return Math.max(0.15, Math.min(0.9, frac));
}

/**
 * Blend of an ABSOLUTE target (what a balanced bed should feel like, whatever
 * the frame) and a FRAME-RELATIVE one. Neither works alone: pure absolute
 * saturates on extreme frames, and pure frame-relative erases the compensate
 * logic entirely — a power frame and a speed frame returned the same top three
 * because both aimed at the same relative position in their own band.
 */
function targetSystemPower(racket: CatalogItem, a: AceDims): number {
  const [lo, hi] = achievablePowerBand(racket);
  const span = hi - lo;
  const absolute = 5.6 - (a.offense - 3) * 0.25 - (a.grip - 3) * 0.1;
  const relative = lo + span * targetPowerFraction(a);
  const blended = absolute * 0.55 + relative * 0.45;
  return Math.max(lo + span * 0.15, Math.min(hi - span * 0.05, blended));
}

/**
 * Stiff shaft + hard string = a harsh, unforgiving bed and the classic
 * tennis-elbow combination. Flexible shaft + soft string = mush with no
 * feedback. The comfortable pairings sit on the diagonal, flex + feel ~= 7
 * across the 1-6 and 1-5 scales. Advanced players tolerate harsh combos
 * deliberately, so the penalty scales down as skill rises.
 */
function scoreFeelBalance(racket: CatalogItem, s: CatalogItem, rank: number): ScoreResult {
  const flex = ordinal(text(racket, 'flex'), FLEX_SCALE, 3.0);
  const feel = num(s, 'feelScale', 3);
  const deviation = Math.abs(flex + feel - 7.0);
  const tolerance = 1.0 + (rank - 1) * 0.6;
  const score = Math.max(0.0, 1.0 - Math.max(0.0, deviation - tolerance) / 3.0);

  if (deviation <= 1.0) {
    // V3. The reference calls `s.get('feel').lower()` here with no fallback —
    // the only unguarded read in a file whose header promises unknown values
    // degrade rather than raise. A catalog row without `feel` crashed it.
    const feelLabel = text(s, 'feel')?.toLowerCase();
    return {
      score,
      reason: feelLabel
        ? `${feelLabel.charAt(0).toUpperCase()}${feelLabel.slice(1)} feel on this shaft — comfortable on off-centre hits, with feedback you can read.`
        : 'Comfortable on this shaft — forgiving on off-centre hits without going vague.',
      warning: null,
    };
  }
  if (flex >= 5 && feel >= 4) {
    return {
      score,
      reason: null,
      warning: 'Stiff shaft plus a hard string — harsh on off-centre hits and the highest-risk combination for elbow and shoulder strain.',
    };
  }
  if (flex <= 2 && feel <= 2) {
    return {
      score,
      reason: null,
      warning: 'Flexible shaft plus a soft string — likely to feel vague, with little feedback.',
    };
  }
  return { score, reason: null, warning: null };
}

/** Does frame-power + string-power land near this player's target? */
function scoreSystemPower(
  racket: CatalogItem,
  s: CatalogItem,
  a: AceDims,
  tension: number | null,
  p: PlayerProfile,
): ScoreResult & { system: number; target: number } {
  const system = racketPowerIndex(racket) * SYSTEM_FRAME_WEIGHT
    + stringPowerIndex(s, tension) * SYSTEM_STRING_WEIGHT;
  const target = targetSystemPower(racket, a);
  const gap = Math.abs(system - target);
  const score = Math.max(0.0, 1.0 - gap / 2.2); // band is ~2.45 wide

  const sys = system.toFixed(1);
  const tgt = target.toFixed(1);
  if (gap <= 1.0) {
    /* The numbers stay in the WARNINGS below, where a member has to act on
       them, and in the sheet's spec rows. As a REASON they were the wrong
       register: "system power 6.2/10 sits on target 6.4" is the engine
       narrating itself, and a member reading WHY THIS wants to know what the
       pairing will feel like in the rallies they actually play. Branching on
       format and attacking intent — both already inputs to `target` — says the
       same thing in the language of their game. */
    const attacking = a.offense >= 3.5;
    if (p.format === 'doubles') {
      return {
        score,
        system,
        target,
        reason: attacking
          ? 'Quick off the strings for flat doubles exchanges, without running your clears long.'
          : 'Repulsion suits doubles pace — the shuttle leaves fast without you having to force it.',
        warning: null,
      };
    }
    if (p.format === 'singles') {
      return {
        score,
        system,
        target,
        reason: 'Enough power to hold length from the rear court without overhitting.',
        warning: null,
      };
    }
    return {
      score,
      system,
      target,
      reason: 'Balances this frame rather than over-driving it — steady length in both singles and doubles.',
      warning: null,
    };
  }
  if (system > target + 2.0) {
    return {
      score,
      system,
      target,
      reason: null,
      warning: `Over-powered pairing (system ${sys} vs target ${tgt}): expect shuttles running long on clears.`,
    };
  }
  if (system < target - 2.0) {
    return {
      score,
      system,
      target,
      reason: null,
      warning: `Under-powered pairing (system ${sys} vs target ${tgt}): you'll be working hard for depth.`,
    };
  }
  return { score, system, target, reason: null, warning: null };
}

export interface StringPairing {
  item: CatalogItem;
  score: number;
  reasons: string[];
  warnings: string[];
  /**
   * Where this row's performance numbers came from, when they are not the
   * manufacturer's. Present only for the rows whose `ratingSource` is a
   * consensus estimate — absent means published, never "unknown".
   *
   * Separate from `warnings` on purpose: see the note at its assignment.
   */
  provenance?: string;
  /**
   * The combined frame-plus-string power index this pairing was scored on,
   * 0-10, and the target it was scored against.
   *
   * Reported as DATA because it stopped being reportable as copy: the reason
   * line used to read "System power 6.2/10 sits on target 6.4", which is the
   * engine narrating its own arithmetic at a member who asked why this string.
   * The figure is still the observable that proves tension actually reaches
   * `scoreSystemPower` (a branch that was dead until 2026-08-21 and whose
   * failure is invisible from the outside), so it moves here rather than
   * disappearing. Nothing renders it; `/api/recommend` does not forward it.
   */
  systemPower: { value: number; target: number };
}

interface ScoreResult {
  /** 0-1, or null when the pair is impossible and must be rejected outright. */
  score: number | null;
  reason: string | null;
  warning: string | null;
  /**
   * True when `reason` is a CAVEAT the member has to act on rather than a
   * description of the pairing. Callers truncate the reason list, so ordering
   * is deletion: a caveat pushed to the end is a caveat that never renders.
   * Caveats keep a front slot; descriptions get demoted below the specific
   * scorers. Only `scoreTension` sets this today.
   */
  caveat?: boolean;
}

/**
 * Do the two rated tension windows overlap usefully?
 *
 * A missing racket ceiling is NOT a rejection — 11 of the 71 catalog frames
 * have no published `tensionMaxLbs`, and refusing to pair them would strand
 * 15% of the catalog. It scores mid and says so.
 */
function scoreTension(racket: CatalogItem, s: CatalogItem): ScoreResult {
  const rLo = num(racket, 'tensionMinLbs', 20);
  const rHi = racket.attributes?.tensionMaxLbs;
  const sLo = num(s, 'tensionMinLbs', 20);
  const sHi = num(s, 'tensionMaxLbs', 26);

  if (typeof rHi !== 'number') {
    return {
      score: 0.6,
      reason: 'Racket tension ceiling unpublished — verify before stringing.',
      warning: null,
      // Actionable, and the only signal that this frame's tension advice is
      // unavailable. Must not be demoted into the truncated tail.
      caveat: true,
    };
  }

  const lo = Math.max(rLo, sLo);
  const hi = Math.min(rHi, sHi);
  if (hi < lo) {
    return {
      score: null,
      reason: null,
      warning: `Incompatible: racket ${rLo}-${rHi} lbs and string ${sLo}-${sHi} lbs have no overlapping range.`,
    };
  }

  /* The window WIDTH scores, but it is no longer a reason. "Wide usable
     tension window (20-28 lbs)" describes the overlap arithmetic, and the
     sheet already prints that range as a spec row — so as a why-this line it
     spent a slot restating something visible two inches above it. The
     ceiling-unpublished CAVEAT above is different and stays: nothing else
     tells the member the tension advice is unavailable. The narrow-window
     WARNING below also stays; it is actionable for a stringer. */
  const width = hi - lo;
  if (width >= 5) {
    return { score: 1.0, reason: null, warning: null };
  }
  if (width >= 2) {
    return { score: 0.75, reason: null, warning: null };
  }
  return {
    score: 0.4,
    reason: null,
    warning: `Very narrow tension window (${lo}-${hi} lbs) — little room for a stringer to adjust.`,
  };
}

/** Rough playing-hours-to-breakage. Calibrated so BG65 under average demand
 *  lands near 35h and Aerosonic near 6h — club-stringer rules of thumb. */
function estimateRestringHours(s: CatalogItem, demand: number): number {
  const base = 4.0 + num(s, 'durability', 6) * 3.6;
  return Math.max(3.0, base * (1.0 - (demand - 5.0) * 0.07));
}

/**
 * Demand side: frame power, attacking intent, court hours. Supply side: the
 * string's durability rating and gauge.
 *
 * V5: `known_string_breaker`, `restring_tolerance` and the play-rate inputs
 * have no source here and run at the reference's defaults. Measured, not
 * assumed — 1.0 vs 3.0 sessions/week returns the same top pick, so the frame
 * power and attacking intent terms carry this scorer on their own.
 */
function scoreDurability(racket: CatalogItem, s: CatalogItem, a: AceDims): ScoreResult {
  const DEFAULT_HOURS_PER_WEEK = 2.0;
  const rp = racketPowerIndex(racket);
  const demand = (rp / 10.0) * 3.0
    + ((a.offense - 1) / 5.0) * 4.0
    + Math.min(3.0, DEFAULT_HOURS_PER_WEEK / 2.0);
  const supply = num(s, 'durability', 6) + (num(s, 'gaugeMm', 0.66) - 0.63) * 10.0;
  const score = Math.max(0.0, Math.min(1.0, 1.0 - (demand - supply) / 6.0));
  const hours = estimateRestringHours(s, demand).toFixed(0);

  /* The hours figure stays on the WARNING below — there it is the actionable
     part — and the `durability` spec row carries the rating itself. As a
     reason it stated a property of the string where the member was asking
     whether it suits THEM, so the two positive branches now name the demand
     the engine actually scored: frame power plus attacking intent. */
  if (score >= 0.75) {
    return { score, reason: 'Stands up to how hard you hit — this pairing is not one you will be restringing often.', warning: null };
  }
  if (score >= 0.45) {
    return { score, reason: 'Fair lifespan for your hitting — expect a restring on a normal club schedule.', warning: null };
  }
  // V4: the reference appends "(about X weeks at your play rate)". With no
  // source for play rate that clause states a fabricated fact about the
  // member, so it is dropped. Hours per restring is a property of the string
  // under a computed demand, not a claim about them, and stays.
  return { score, reason: null, warning: `High breakage risk: roughly ${hours} hours per restring.` };
}

const TIER_STRING_BUDGET: Record<string, [number, number, number]> = {
  Premium: [12, 17, 24],
  'Mid-range': [9, 13, 19],
  'Entry-level': [6, 10, 15],
};

/**
 * Spend fit, keyed to frame TIER rather than a raw price ratio. A pure
 * percentage-of-frame-price rule rated a $12 training string on a $235
 * flagship as proportionate; it isn't, because thick budget strings flatten
 * exactly the feel a premium frame was bought for. Under-spending on a premium
 * frame is penalised as hard as over-spending on an entry one.
 */
function scoreValue(racket: CatalogItem, s: CatalogItem): ScoreResult {
  const tier = text(racket, 'tier') ?? 'Mid-range';
  const [lo, ideal, hi] = TIER_STRING_BUDGET[tier] ?? TIER_STRING_BUDGET['Mid-range'];
  const price = (num(s, 'priceSetUsdMin', 12) + num(s, 'priceSetUsdMax', 12)) / 2;
  const span = Math.max(hi - lo, 1);
  const score = Math.max(0.0, 1.0 - Math.abs(price - ideal) / span);
  const shown = price.toFixed(0);

  if (price < lo * 0.85 && tier === 'Premium') {
    return {
      score,
      reason: null,
      warning: `Under-strung for the frame: a $${shown} set on a ${tier.toLowerCase()} racket flattens the feel you paid for.`,
    };
  }
  if (price > hi * 1.15) {
    return {
      score,
      reason: null,
      warning: `Premium string ($${shown}/set) on a ${tier.toLowerCase()} frame — the frame is the bigger lever.`,
    };
  }
  if (score >= 0.65) {
    return { score, reason: `Priced for what this frame is built to do — no need to spend up or down from here.`, warning: null };
  }
  return { score, reason: null, warning: null };
}

/** Multiplies the total rather than adding to it, so a string rated well above
 *  the player cannot win on the other four scorers. */
function skillMultiplier(s: CatalogItem, rank: number): ScoreResult {
  const label = text(s, 'skillLevel');
  const normalized = label ? label.toLowerCase() : null;
  const known = normalized
    ? ({ beginner: 1, intermediate: 2, advanced: 3 } as Record<string, number>)[normalized]
    : undefined;
  const diff = (known ?? 2) - rank;
  if (diff <= 0) return { score: 1.0, reason: null, warning: null };

  const score = diff === 1 ? 0.6 : SKILL_MULTIPLIER_FLOOR;

  /* The `?? 2` fallback is a SCORING assumption, not a fact about the string.
     Interpolating the absent label rendered "Rated for undefined players" to
     the member — a fabricated claim, and the legible-fail rule in reverse: an
     unknown presented as a known. Say only what we actually have. */
  if (known === undefined || normalized === null) {
    return {
      score,
      reason: null,
      warning: 'This string has no published skill rating — scored as intermediate, which is above your current level.',
    };
  }

  if (diff === 1) {
    return {
      score,
      reason: null,
      warning: `Rated for ${normalized} players — a step up from your current level.`,
    };
  }
  return {
    score,
    reason: null,
    warning: `Rated for ${normalized} players — likely to break fast and give little back at your current level.`,
  };
}

/**
 * Where inside the racket-and-string overlap to place this player, in lbs.
 *
 * D2: this is the app's tension answer wherever it can be given, and
 * `lib/tension.ts` (level-based, frame-agnostic) is the fallback for the two
 * cases it cannot cover — no catalog racket on file, and the 11 of 71 frames
 * with no published ceiling, which return null here.
 *
 * Consistency of contact — grip mechanics plus movement — is what earns higher
 * tension, because high tension shrinks the sweet spot.
 */
export function pairTension(
  racket: CatalogItem,
  s: CatalogItem,
  profile: PlayerProfile,
): number | null {
  const rHi = racket.attributes?.tensionMaxLbs;
  if (typeof rHi !== 'number') return null;

  const lo = Math.max(num(racket, 'tensionMinLbs', 20), num(s, 'tensionMinLbs', 20));
  const hi = Math.min(rHi, num(s, 'tensionMaxLbs', 26));
  if (hi < lo) return null;

  const a = aceDims(profile);
  const consistency = ((a.grip + a.movement) / 2.0 - 1) / 5.0;
  const placed = lo + (hi - lo) * Math.min(1.0, consistency * 0.9 + 0.1);
  return Math.round(placed * 2) / 2;
}

/**
 * Rank the catalog's strings for one frame and return the best pair, or null
 * when every candidate was rejected by the tension gate.
 *
 * Returns ONE pairing, not a ranked list: the rail renders a single card per
 * category. The reference's `top_n` and `brand_match` are deliberately not
 * ported (spec V6) — there is nothing to display them.
 */
export function pairString(
  racket: CatalogItem,
  strings: CatalogItem[],
  profile: PlayerProfile,
): StringPairing | null {
  const dims = aceDims(profile);
  // V2: one definition of Advanced, shared with the racket engine.
  const rank = { Beginner: 1, Intermediate: 2, Advanced: 3 }[skillLevel(profile)];
  let best: StringPairing | null = null;

  for (const s of strings) {
    if (s.category !== 'string') continue;

    const reasons: string[] = [];
    const warnings: string[] = [];

    const tension = scoreTension(racket, s);
    if (tension.score === null) continue; // hard gate

    /* Tension is resolved BEFORE the power scorer, because a string's power
       contribution depends on the tension it will actually be strung at
       (reference: pair_racket_string.py:474). Passing `null` here — as this
       did until 2026-08-21 — pinned every candidate to the 24.0 lb default,
       so `stringPowerIndex`'s whole tension branch was dead code and the app
       scored a string at one tension while telling the member to string it at
       another. It changed the winning string for up to 36 of 71 frames.

       `pairTension` returns null for the 11 ceiling-less frames, which is the
       old behaviour exactly — so this degrades to the previous result
       precisely where it has no better answer. */
    const recommendedTension = pairTension(racket, s, profile);

    // A tension CAVEAT keeps its front slot; only the generic window-width
    // description is demoted (below). Demoting both pushed "ceiling
    // unpublished — verify before stringing" past the caller's reason limit,
    // deleting the one line that tells the member the advice is unavailable.
    if (tension.reason && tension.caveat) reasons.push(tension.reason);

    const power = scoreSystemPower(racket, s, dims, recommendedTension, profile);
    if (power.reason) reasons.push(power.reason);
    if (power.warning) warnings.push(power.warning);

    const feel = scoreFeelBalance(racket, s, rank);
    if (feel.reason) reasons.push(feel.reason);
    if (feel.warning) warnings.push(feel.warning);

    const durability = scoreDurability(racket, s, dims);
    if (durability.reason) reasons.push(durability.reason);
    if (durability.warning) warnings.push(durability.warning);

    const value = scoreValue(racket, s);
    if (value.reason) reasons.push(value.reason);
    if (value.warning) warnings.push(value.warning);

    /* Only the caveat form of tension carries a reason now (pushed first,
       above); the window-width description was demoted out of the reason list
       entirely — see scoreTension. Its warning still lands here. */
    if (tension.warning) warnings.push(tension.warning);

    const skill = skillMultiplier(s, rank);
    if (skill.warning) warnings.push(skill.warning);

    /* Provenance. 13 of the 46 seeded strings carry community-estimated
       ratings; without this the numbers above read as manufacturer-published.
       Dropped in the original port, not a documented deviation.

       Reported on its own field rather than pushed into `warnings`. It is a
       statement about where the NUMBERS came from, not a safety flag about
       the pairing, and the two had to be told apart once the sheet started
       rendering them differently: warnings stay inline and uncollapsed, while
       provenance joins the muted caveat paragraph under the action. Merging
       it into that paragraph unconditionally would have been the other bug —
       the other 33 rows ARE manufacturer-published, and saying otherwise
       about them is a false claim, not a cautious one. */
    const provenance = text(s, 'ratingSource') === 'Consensus estimate'
      ? 'Performance ratings are community consensus, not manufacturer-published.'
      : undefined;

    const weighted = tension.score * 20
      + (power.score ?? 0) * 30
      + (feel.score ?? 0) * 20
      + (durability.score ?? 0) * 20
      + (value.score ?? 0) * 10;
    const score = weighted * (skill.score ?? 1);

    /* Deterministic tie-break by model, as the reference's
       `sort(key=(-score, model))` does. Cosmos does not guarantee row order,
       so first-encountered-wins let two equally-scored strings swap places
       between requests — the member saw a different "our pick" on refresh
       having changed nothing. */
    if (!best || score > best.score || (score === best.score && s.model < best.item.model)) {
      best = {
        item: s, score, reasons, warnings, provenance,
        systemPower: { value: power.system, target: power.target },
      };
    }
  }

  return best;
}
