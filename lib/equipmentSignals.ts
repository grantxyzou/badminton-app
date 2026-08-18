import { bottomKeys } from './insightSignals';
import { SKILLS, type StoredAssessment } from './assessment';
import { recommendRacket } from './recommend';
import type { CanonicalLevel } from './level';
import type { CatalogItem } from './types';

/**
 * Equipment signals — the deterministic half of the racket insight.
 *
 * Mirrors `lib/insightSignals.ts`: this module finds a genuine, computable
 * relationship between how a player is playing and the racket they own, and
 * the AI only narrates the strongest one. Signals carry `facts` the narrator
 * must stay within. Nothing above threshold means the card says nothing.
 *
 * Pure: no I/O, no dates read from the clock. Unit-tested.
 */

const LABEL_BY_KEY = new Map(SKILLS.map((s) => [s.key, s.label]));
const labelOf = (key: string): string => LABEL_BY_KEY.get(key) ?? key;

/**
 * Which racket builds make which skills harder.
 *
 * THIS TABLE IS BADMINTON JUDGEMENT, NOT DERIVED DATA. It is deliberately a
 * plain exported array so a wrong row is a one-line edit, not a logic change.
 *
 * `fights()` below is an OR across balance/flex/weight: ANY ONE matching
 * attribute is enough to flag the conflict — the traits do not need to
 * combine. Read each row that way:
 *   - Row 1 (drops/net_play): an extra-stiff flex OR a head-heavy balance
 *     each independently punish touch — a head-heavy racket with a soft
 *     flex still fights these skills, and so does an even-balance racket
 *     that's extra stiff.
 *   - Row 2 (smashes/clears_lifts): a flexible flex OR a head-light balance
 *     each independently punish rear-court power, same independence.
 *   - Row 3 (footwork_split_step/speed_stamina/court_coverage): a head-heavy
 *     balance OR a 3U (heavy) weight class each independently make court
 *     coverage harder — a light head-heavy frame and a heavy even-balance
 *     frame BOTH match this row on their own; the racket need not be both
 *     heavy AND head-heavy.
 *
 * Keys are the real SKILLS keys from lib/assessment.ts:
 *   serves_returns net_play clears_lifts drops drives smashes grip_deception
 *   footwork_split_step court_coverage speed_stamina game_reading
 *   consistency rules_strategy training_mindset
 */
export const SKILL_SPEC_CONFLICTS: {
  skills: string[];
  fights: { balance?: 'head-heavy' | 'head-light'; flex?: string; weight?: string };
}[] = [
  { skills: ['drops', 'net_play'], fights: { balance: 'head-heavy', flex: 'extra stiff' } },
  { skills: ['smashes', 'clears_lifts'], fights: { balance: 'head-light', flex: 'flexible' } },
  { skills: ['footwork_split_step', 'speed_stamina', 'court_coverage'], fights: { balance: 'head-heavy', weight: '3U' } },
];

export type EquipmentSignalKind = 'phase-mismatch' | 'weakness-conflict' | 'outgrowing';

export interface EquipmentSignal {
  kind: EquipmentSignalKind;
  /** 0..1 notability. The route narrates only the highest. */
  score: number;
  /** Grounded values the narrator may not exceed. */
  facts: Record<string, string | number>;
  /** Plain-English seed the model rephrases. Never shown raw. */
  hint: string;
  /** Catalog id to recommend. Present only when the diagnosis implies a
   *  direction — a diagnosis with no clear alternative suggests nothing. */
  suggests?: string;
}

export interface EquipmentSignalInput {
  snapshots: StoredAssessment[];
  canonicalLevel?: CanonicalLevel | null;
  /** The player's ACTIVE racket, resolved by the caller. */
  racket: CatalogItem | null;
  catalog: CatalogItem[];
}

/** Matches the engine-wide threshold in insightSignals. */
export const EQUIPMENT_SIGNAL_THRESHOLD = 0.35;

function attr(item: CatalogItem, key: string): string {
  const v = item.attributes?.[key];
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/** 'head-light' | 'head-heavy' | 'even' | ''. Strips a leading "slightly ". */
function balanceOf(item: CatalogItem): string {
  const raw = attr(item, 'balance').replace(/^slightly\s+/, '');
  if (raw.includes('head-light')) return 'head-light';
  if (raw.includes('head-heavy')) return 'head-heavy';
  if (raw === 'even') return 'even';
  return '';
}

/** Combined classes ("3U/4U") take their first term. */
function weightOf(item: CatalogItem): string {
  return attr(item, 'weight').split('/')[0].trim();
}

/** Collapses hyphens/whitespace to a single space so "extra-stiff" and
 *  "Extra Stiff" both normalize to "extra stiff" and compare equal against
 *  the space-separated values in SKILL_SPEC_CONFLICTS. The real catalog has
 *  both forms (six "Extra Stiff", one "extra-stiff"). */
function flexOf(item: CatalogItem): string {
  return attr(item, 'flex').replace(/[-\s]+/g, ' ');
}

/** True when this racket carries the attribute the rule says fights the skill. */
function fights(item: CatalogItem, f: (typeof SKILL_SPEC_CONFLICTS)[number]['fights']): boolean {
  if (f.balance && balanceOf(item) === f.balance) return true;
  if (f.flex && flexOf(item) === f.flex) return true;
  if (f.weight && weightOf(item) === f.weight.toLowerCase()) return true;
  return false;
}

/** Best catalog pick that satisfies `ok`, never the racket already owned. */
function suggestFrom(input: EquipmentSignalInput, ok: (c: CatalogItem) => boolean): string | undefined {
  const pool = input.catalog.filter((c) => c.category === 'racket' && c.id !== input.racket?.id && ok(c));
  if (pool.length === 0) return undefined;
  const pick = recommendRacket({ stage: input.canonicalLevel?.stage ?? undefined, catalog: pool });
  return pick?.id;
}

export function computeEquipmentSignals(input: EquipmentSignalInput): EquipmentSignal[] {
  const { racket } = input;
  if (!racket) return []; // No racket, no diagnosis.

  const signals: EquipmentSignal[] = [];
  // CanonicalLevel carries BOTH `level` (1-5 headline) and `stage` (1-6).
  // skillRange is on the 1-6 scale and lib/level.ts documents `stage` as the
  // "bridge for gear skillRange / stage consumers" — using `level` here would
  // silently compare two different scales.
  const stage = input.canonicalLevel?.stage ?? undefined;

  // ── A. Phase mismatch — arithmetic, no domain judgement. ──
  if (typeof stage === 'number' && Array.isArray(racket.skillRange)) {
    const [lo, hi] = racket.skillRange;
    const distance = stage < lo ? lo - stage : stage > hi ? stage - hi : 0;
    if (distance > 0) {
      const direction = stage < lo ? 'below' : 'above';
      signals.push({
        kind: 'phase-mismatch',
        score: distance >= 2 ? 0.8 : 0.5,
        facts: { direction, stage, rangeLow: lo, rangeHigh: hi, racket: `${racket.brand} ${racket.model}` },
        hint:
          direction === 'below'
            ? `Their racket is built for players around phase ${lo}-${hi} and they are at ${stage} — it is asking more of them than it gives back.`
            : `They are at phase ${stage} and their racket tops out around ${hi} — they have grown past it.`,
        suggests: suggestFrom(input, (c) => c.skillRange[0] <= stage && stage <= c.skillRange[1]),
      });
    }
  }

  // ── B. Weakness the racket fights — the diagnosis. Needs a REPEATED
  //      weakness, so it can only fire on a real pattern. ──
  const snaps = [...input.snapshots].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  if (snaps.length >= 2) {
    const latest = snaps[snaps.length - 1];
    const recent = snaps.slice(-3);
    const persistent = bottomKeys(latest, 3).filter(
      (k) => recent.filter((s) => bottomKeys(s, 3).includes(k)).length >= 2,
    );
    for (const key of persistent) {
      const rule = SKILL_SPEC_CONFLICTS.find((r) => r.skills.includes(key));
      if (!rule || !fights(racket, rule.fights)) continue;
      const count = recent.filter((s) => bottomKeys(s, 3).includes(key)).length;
      signals.push({
        kind: 'weakness-conflict',
        score: Math.min(0.9, count / 3),
        facts: {
          skill: labelOf(key),
          count,
          racket: `${racket.brand} ${racket.model}`,
          build: [balanceOf(racket), weightOf(racket).toUpperCase(), flexOf(racket)].filter(Boolean).join(', '),
        },
        hint: `${labelOf(key)} has stayed among their weakest across ${count} check-ins, and their racket's build is the hardest kind to play that shot with.`,
        suggests: suggestFrom(input, (c) => !fights(c, rule.fights)),
      });
      break; // One diagnosis is enough; a list of complaints is not a nudge.
    }
  }

  // ── C. Outgrowing — readiness, not a problem. Deliberately scored below
  //      A and B so a real problem always wins. ──
  if (typeof stage === 'number' && Array.isArray(racket.skillRange) && racket.skillRange[1] <= 3 && stage >= 3) {
    signals.push({
      kind: 'outgrowing',
      score: 0.4,
      facts: { stage, rangeHigh: racket.skillRange[1], racket: `${racket.brand} ${racket.model}` },
      hint: `They are at phase ${stage} on a racket aimed at phase ${racket.skillRange[1]} and below — they may be ready for more.`,
      suggests: suggestFrom(input, (c) => c.skillRange[1] > racket.skillRange[1]),
    });
  }

  return signals;
}

/** Highest-scoring signal at or above threshold, else null. */
export function pickEquipmentSignal(signals: EquipmentSignal[]): EquipmentSignal | null {
  const eligible = signals.filter((s) => s.score >= EQUIPMENT_SIGNAL_THRESHOLD);
  return eligible.sort((a, b) => b.score - a.score)[0] ?? null;
}
