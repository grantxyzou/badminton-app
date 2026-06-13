/**
 * Badminton skill self-assessment — content + scoring.
 *
 * Source of truth for content and scoring logic: `docs/badminton-spec-md.md` (P0).
 * Pure module (no I/O) so it can be unit-tested directly against the spec's
 * numbers and reused by both the API route and the UI.
 *
 * Roadmap (spec §1): P0 self (this) → P1 peer → P2 AI. The `Rating.source`
 * field exists now so P1/P2 attach without restructuring.
 */

export type Dimension = 'technical' | 'physical' | 'mental';

export interface SkillDef {
  key: string;
  dimension: Dimension;
  label: string;
  /** Descriptive anchors for rating values 1..5 (index 0 = level 1). */
  anchors: [string, string, string, string, string];
}

export interface Rating {
  skillKey: string;
  /** 1–5. The number is for scoring; the player picks by the anchor (spec §3). */
  value: number;
  /** Rater source. P0 is always 'self' (spec §8). */
  source?: 'self' | 'peer' | 'ai';
}

export type Phase = 'foundation' | 'exploration' | 'switch' | 'commitment' | 'advanced';

/**
 * The 14 skills across 3 dimensions, with exact anchor copy from spec §4.
 * (The spec's prose says "15"; it lists 14 — count corrected in the doc.)
 */
export const SKILLS: SkillDef[] = [
  // ── Technical / Tactical (7) ──────────────────────────────────────────────
  {
    key: 'serves_returns',
    dimension: 'technical',
    label: 'Serves & Returns',
    anchors: [
      'My serve is easily attacked; returns often go long or into the net.',
      'I get serves in on easy points, but they sit up or get punished under pressure.',
      "Reliable low/high serve in games — I'm starting to practice them on purpose.",
      'Consistent serves I place intentionally; my returns put me on the front foot.',
      'Serve & return are weapons — varied, disguised, and pressuring from shot one.',
    ],
  },
  {
    key: 'net_play',
    dimension: 'technical',
    label: 'Net Play',
    anchors: [
      'I mostly avoid the net; my net shots pop up or go into the tape.',
      "I can play a net shot in a slow rally but can't kill loose shuttles reliably.",
      "Tight-ish net shots in games — I'm drilling spin and net kills deliberately.",
      'Consistent tight net play; I kill loose lifts and control the front court.',
      'I dominate the net — spinning, tumbling, killing, and dictating the rally.',
    ],
  },
  {
    key: 'clears_lifts',
    dimension: 'technical',
    label: 'Clears & Lifts',
    anchors: [
      "I can't reliably reach the back; clears land mid-court and get smashed.",
      'I clear to the back on easy shots but lose depth when rushed.',
      "Decent depth in games — I'm training to hit the back tramlines consistently.",
      'Consistent deep clears/lifts that buy me time and reset the rally.',
      'I clear with disguise and pinpoint depth to control tempo and force replies.',
    ],
  },
  {
    key: 'drops',
    dimension: 'technical',
    label: 'Drops',
    anchors: [
      'I rarely play drops; they land too short or sit up to be killed.',
      "I attempt drops occasionally but they're loose and predictable.",
      "Workable drops in games — I'm practicing tighter, deceptive ones.",
      'Consistent tight drops I use tactically to move opponents and open the court.',
      'Sharp, disguised slice/fast drops that win or set up points outright.',
    ],
  },
  {
    key: 'drives',
    dimension: 'technical',
    label: 'Drives',
    anchors: [
      "Flat exchanges overwhelm me; I can't keep the shuttle low.",
      'I can drive in a slow exchange but lose flat-rally battles.',
      'I hold my own in drives — starting to train flat-rally speed on purpose.',
      'Consistent, fast, flat drives; I win most mid-court exchanges.',
      'I control flat rallies — punishing, accurate, and varied in pace and angle.',
    ],
  },
  {
    key: 'smashes',
    dimension: 'technical',
    label: 'Smashes',
    anchors: [
      'My smash has little power/placement; I rarely win points with it.',
      "I can smash a sitter but it's slow and easily defended.",
      "Decent smash in games — I'm training power, steepness, and placement.",
      'Consistent, well-placed smashes I use to finish or pressure opponents.',
      'A genuine weapon — steep, powerful, placed, and a real point-ender.',
    ],
  },
  {
    key: 'grip_deception',
    dimension: 'technical',
    label: 'Grip & Deception',
    anchors: [
      "I hold one tight grip; I can't change grips or disguise shots.",
      'I change grips slowly; opponents read my shots early.',
      "I'm working on a loose grip and starting to disguise some shots.",
      'Loose grip with quick changes; I disguise direction on several shots.',
      'Loose-grip mastery — quick changes and consistent deception across the court.',
    ],
  },
  // ── Physical (3) ──────────────────────────────────────────────────────────
  {
    key: 'footwork_split_step',
    dimension: 'physical',
    label: 'Footwork & Split Step',
    anchors: [
      'I run flat-footed and arrive late; no split step.',
      'I move okay on easy shots but get caught flat-footed under pressure.',
      "I use a split step in games and I'm drilling movement on purpose.",
      'Efficient footwork, consistent split step, leading with the racket leg.',
      "Explosive, economical movement — I appear 'light' and rarely get caught out.",
    ],
  },
  {
    key: 'court_coverage',
    dimension: 'physical',
    label: 'Court Coverage & Positioning',
    anchors: [
      'I cover only what is near me; big gaps open across the court.',
      'I reach most shots in slow rallies but get pulled out of position.',
      "Decent coverage — I'm learning singles/doubles positioning roles.",
      'Strong coverage; I understand and hold my role in doubles and singles.',
      'I cover the court seamlessly and anticipate to be in position early.',
    ],
  },
  {
    key: 'speed_stamina',
    dimension: 'physical',
    label: 'Speed & Stamina',
    anchors: [
      'I tire quickly; pace and quality drop within a game.',
      'I last a casual game but fade in longer or faster rallies.',
      "Decent endurance — I'm adding conditioning to support harder play.",
      'Good stamina; my movement quality holds across multiple games.',
      'High-performance fitness — quality degrades only after sustained effort.',
    ],
  },
  // ── Mental / Emotional (4) ────────────────────────────────────────────────
  {
    key: 'game_reading',
    dimension: 'mental',
    label: 'Game Reading & Shot Selection',
    anchors: [
      'I react late and hit whatever I can reach; no real plan.',
      'I sometimes pick the right shot but mostly play reactively.',
      "I'm starting to read opponents and choose shots with intent.",
      'I anticipate from body/racket cues and select shots tactically.',
      'I read the game several shots ahead and construct points deliberately.',
    ],
  },
  {
    key: 'consistency',
    dimension: 'mental',
    label: 'Consistency',
    anchors: [
      'Lots of unforced errors; I go for lines and miss often.',
      'Inconsistent — good shots mixed with frequent errors.',
      "Fewer errors — I'm learning to 'bring margins in' on purpose.",
      'Consistent and low-error; I aim with safe margins under pressure.',
      'Rock-solid consistency; I force errors while making almost none.',
    ],
  },
  {
    key: 'rules_strategy',
    dimension: 'mental',
    label: 'Rules, Etiquette & Strategy',
    anchors: [
      'I am unsure of rules, scoring, and court etiquette.',
      'I know basic rules and scoring but little strategy.',
      'Comfortable with rules/formats; starting to think tactically.',
      'Solid grasp of strategy, formats, and assessing my level of play.',
      'Deep tactical and format knowledge; I game-plan per opponent.',
    ],
  },
  {
    key: 'training_mindset',
    dimension: 'mental',
    label: 'Training Mindset — the Switch',
    anchors: [
      "I just turn up and play; I don't think about improving.",
      "I play often and want to get better, but don't train deliberately.",
      "The switch: I'm starting to TRAIN for badminton, not just play it.",
      'I train with structure — drills, conditioning, and self-assessment.',
      'Full high-performance mindset: discipline, goals, recovery, the lot.',
    ],
  },
];

const SKILL_BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));
const SKILL_INDEX = new Map(SKILLS.map((s, i) => [s.key, i]));

export interface AssessmentScore {
  overall: number | null;
  dimensionScores: Record<Dimension, number | null>;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

/** §5: dimension score = avg of rated skills in the dimension; overall = avg of
 *  all rated skills. Unknown skill keys and unrated skills are ignored. */
export function scoreAssessment(ratings: Rating[]): AssessmentScore {
  const known = ratings.filter((r) => SKILL_BY_KEY.has(r.skillKey));
  const byDim: Record<Dimension, number[]> = { technical: [], physical: [], mental: [] };
  for (const r of known) {
    byDim[SKILL_BY_KEY.get(r.skillKey)!.dimension].push(r.value);
  }
  return {
    overall: avg(known.map((r) => r.value)),
    dimensionScores: {
      technical: avg(byDim.technical),
      physical: avg(byDim.physical),
      mental: avg(byDim.mental),
    },
  };
}

function sortedKnown(ratings: Rating[], dir: 'desc' | 'asc'): Rating[] {
  return ratings
    .filter((r) => SKILL_BY_KEY.has(r.skillKey))
    .slice()
    .sort((a, b) => {
      const byValue = dir === 'desc' ? b.value - a.value : a.value - b.value;
      if (byValue !== 0) return byValue;
      // Deterministic tie-break by spec skill order.
      return SKILL_INDEX.get(a.skillKey)! - SKILL_INDEX.get(b.skillKey)!;
    });
}

/** §5: the n highest-rated skills. */
export function topStrengths(ratings: Rating[], n = 3): Rating[] {
  return sortedKnown(ratings, 'desc').slice(0, n);
}

/** §5: the n lowest-rated skills. */
export function workOnNext(ratings: Rating[], n = 3): Rating[] {
  return sortedKnown(ratings, 'asc').slice(0, n);
}

/** §6 phase bands, highest first so the first match wins. Exported so the
 *  canonical-level hysteresis (`lib/level.ts`) can read band minimums without
 *  re-declaring them. */
export const PHASE_BANDS: { phase: Phase; min: number }[] = [
  { phase: 'advanced', min: 4.3 },
  { phase: 'commitment', min: 3.4 },
  { phase: 'switch', min: 2.6 },
  { phase: 'exploration', min: 1.8 },
  { phase: 'foundation', min: 1.0 },
];

/** §6: the highest phase whose minimum the overall score meets or exceeds. */
export function placePhase(overall: number | null): Phase | null {
  if (overall === null) return null;
  for (const band of PHASE_BANDS) {
    if (overall >= band.min) return band.phase;
  }
  return 'foundation';
}

/** A stored self-assessment snapshot (one `assessments` doc). Numbers are
 *  frozen at POST time, so a summary reads them off the doc rather than
 *  recomputing — keeping narration consistent with what the trend card shows. */
export interface StoredAssessment {
  takenAt: string;
  ratings: Rating[];
  overall: number | null;
  phase?: Phase | null;
  dimensionScores?: Record<Dimension, number | null>;
}

/** A labelled skill rating, for human-readable strength/work-on lists. */
export interface LabelledRating {
  key: string;
  label: string;
  value: number;
}

/** Trend summary across a member's snapshots — the shape both the insight
 *  narrator and any future trend consumer can read without re-deriving. */
export interface AssessmentTrend {
  /** ISO timestamp of the most recent snapshot — also the cache-invalidation key. */
  latestAt: string;
  /** Total snapshots on record. */
  count: number;
  overall: number | null;
  phase: Phase | null;
  /** Overall of the immediately-previous snapshot ("Then"), or null if first. */
  prevOverall: number | null;
  /** latest.overall − prev.overall, or null when either side is missing. */
  delta: number | null;
  /** Top-3 highest-rated skills in the latest snapshot. */
  strengths: LabelledRating[];
  /** Bottom-3 lowest-rated skills in the latest snapshot. */
  workOn: LabelledRating[];
}

function labelRating(r: Rating): LabelledRating {
  return { key: r.skillKey, label: SKILL_BY_KEY.get(r.skillKey)?.label ?? r.skillKey, value: r.value };
}

/**
 * Summarize a member's stored self-assessment snapshots for trend narration.
 *
 * Docs may arrive unsorted; we sort ascending by `takenAt` and read the latest.
 * "Then" is the immediately-previous snapshot — matching `SkillTrendCard`'s
 * `prev = snapshots[length-2]` so the insight's delta agrees with the radar.
 * Scores/phase are read off the latest doc (frozen at POST); only the
 * strength/work-on ordering is derived from `ratings`. Returns null when there
 * are no snapshots.
 */
export function summarizeAssessmentTrend(docs: StoredAssessment[]): AssessmentTrend | null {
  const sorted = docs
    .filter((d): d is StoredAssessment => !!d && typeof d.takenAt === 'string')
    .slice()
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;
  const prev = sorted.length > 1 ? sorted[sorted.length - 2] : undefined;
  const latestOverall = latest.overall ?? null;
  const prevOverall = prev?.overall ?? null;
  const ratings = Array.isArray(latest.ratings) ? latest.ratings : [];
  return {
    latestAt: latest.takenAt,
    count: sorted.length,
    overall: latestOverall,
    phase: latest.phase ?? placePhase(latestOverall),
    prevOverall,
    delta: latestOverall !== null && prevOverall !== null ? latestOverall - prevOverall : null,
    strengths: topStrengths(ratings, 3).map(labelRating),
    workOn: workOnNext(ratings, 3).map(labelRating),
  };
}
