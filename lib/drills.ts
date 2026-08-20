/**
 * Drill recommendations — pure, deterministic engine over a static library.
 *
 * Same posture as `lib/recommend.ts` (Decision B2): a deterministic picker here,
 * with Claude narrating separately in the insight prompt. No I/O, no container —
 * the library is read-only reference JSON imported at build time.
 *
 * Input is the member's `workOn` list (the lowest-rated skills, already computed
 * by `workOnNext` / `AssessmentTrend.workOn` — same `{ key, label, value }`
 * shape). For each, we pick a drill whose band contains that skill's own rating
 * (nearest-band fallback), rotating the choice by `rotationSeed` (the active
 * session id) so the same weak skill cycles drills week to week without RNG.
 */

import library from '@/scripts/data/drill-library.json';
import { getContainer, ensureContainer, getActiveSessionId } from './cosmos';
import { summarizeAssessmentTrend, type StoredAssessment } from './assessment';

export interface Drill {
  id: string;
  skillKey: string;
  band: [number, number];
  title: string;
  description: string;
  minutes: number;
  setting: 'solo' | 'pair' | 'group';
  equipment?: string[];
}

export interface DrillPick {
  id: string;
  skillKey: string;
  skillLabel: string;
  title: string;
  description: string;
  minutes: number;
  setting: 'solo' | 'pair' | 'group';
  band: [number, number];
  /** Why this drill — e.g. "For your net play (rated 2/5)". */
  reason: string;
}

export interface WorkOnSkill {
  key: string;
  label: string;
  value: number;
}

/** The validated drill list. The JSON infers wider types (`band: number[]`,
 *  `setting: string`), so we cast through `unknown` — the data conforms to
 *  `Drill` by construction and the coverage test guards the shape. */
export const DRILLS: Drill[] = (library as unknown as { drills: Drill[] }).drills;

const DRILLS_BY_SKILL: Map<string, Drill[]> = (() => {
  const m = new Map<string, Drill[]>();
  for (const d of DRILLS) {
    const list = m.get(d.skillKey) ?? [];
    list.push(d);
    m.set(d.skillKey, list);
  }
  return m;
})();

/** Stable small hash (FNV-1a) so the same seed+skill always picks the same drill. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function bandContains(band: [number, number], value: number): boolean {
  return value >= band[0] && value <= band[1];
}

function bandMid(band: [number, number]): number {
  return (band[0] + band[1]) / 2;
}

/**
 * Candidate drills for a skill at a given rating: those whose band contains the
 * value, else (nothing exact) the ones nearest by band midpoint. Empty only when
 * the skill key has no drills at all.
 */
function candidatesFor(skillKey: string, value: number): Drill[] {
  const all = DRILLS_BY_SKILL.get(skillKey);
  if (!all || all.length === 0) return [];
  const inBand = all.filter((d) => bandContains(d.band, value));
  if (inBand.length > 0) return inBand;
  // Nearest-band fallback: smallest midpoint distance (ties keep all nearest).
  let best = Infinity;
  for (const d of all) best = Math.min(best, Math.abs(bandMid(d.band) - value));
  return all.filter((d) => Math.abs(bandMid(d.band) - value) === best);
}

function toPick(drill: Drill, skill: WorkOnSkill): DrillPick {
  return {
    id: drill.id,
    skillKey: drill.skillKey,
    skillLabel: skill.label,
    title: drill.title,
    description: drill.description,
    minutes: drill.minutes,
    setting: drill.setting,
    band: drill.band,
    reason: `For your ${skill.label.toLowerCase()} (rated ${skill.value}/5)`,
  };
}

/**
 * Recommend up to `count` drills for the member's work-on skills. Deterministic
 * for a given `(workOn, rotationSeed)` — re-running returns identical picks, and
 * a new `rotationSeed` (next session) rotates to different drills.
 */
export function recommendDrills(input: {
  workOn: WorkOnSkill[];
  level: number | null;
  rotationSeed: string;
  count?: number;
}): DrillPick[] {
  const { workOn, rotationSeed, count = 3 } = input;
  if (!Array.isArray(workOn) || workOn.length === 0) return [];

  const picks: DrillPick[] = [];
  for (const skill of workOn) {
    if (picks.length >= count) break;
    if (!skill || typeof skill.key !== 'string' || typeof skill.value !== 'number') continue;
    const candidates = candidatesFor(skill.key, skill.value);
    if (candidates.length === 0) continue;
    // Deterministic rotation: index by seed+skill so the choice is stable within
    // a session and cycles across sessions.
    const idx = hash(`${rotationSeed}:${skill.key}`) % candidates.length;
    picks.push(toPick(candidates[idx], skill));
  }
  return picks;
}

/**
 * Impure counterpart to the pure picker above — I/O lives here, deliberately,
 * so the two current callers (`GET /api/stats/drills` and `GET /api/recommend`)
 * share ONE work-on derivation instead of each growing their own copy that can
 * drift. Both need the same "member's weakest skills → drill picks" answer;
 * `/api/recommend` uses it to ground a gear pick's reasons in what the member
 * is actually practising.
 *
 * Failures degrade to `[]` (a member with no readable assessment history just
 * gets no drill picks) rather than throwing — matching the read-tolerant
 * posture of `fetchWorkOn` in the drills route this was extracted from.
 */

/** Latest work-on skills for a member (lowest-rated), or [] when none/unavailable. */
async function fetchWorkOn(memberId: string): Promise<WorkOnSkill[]> {
  try {
    await ensureContainer('assessments', '/memberId');
    const { resources } = await getContainer('assessments').items
      .query({
        query: 'SELECT c.memberId, c.takenAt, c.ratings, c.overall, c.phase FROM c WHERE c.memberId = @memberId',
        parameters: [{ name: '@memberId', value: memberId }],
      })
      .fetchAll();
    const docs = (resources as (StoredAssessment & { memberId?: string })[]).filter(
      (d) => d && d.memberId === memberId && typeof d.takenAt === 'string',
    );
    return summarizeAssessmentTrend(docs)?.workOn ?? [];
  } catch (err) {
    console.error('drills: workOn read failed:', err);
    return [];
  }
}

/**
 * This week's drill picks for a member, derived from their weakest skills.
 *
 * Only takes a `memberId` (not the full `LevelSubject` — no `name` needed):
 * `recommendDrills` accepts a `level` for future use but does not read it in
 * today's picker logic, so this does not fetch `getCanonicalLevel` (which
 * needs a `name` to key the group-calibration fold) and passes `level: null`.
 * A caller that only has a memberId in hand (like /api/recommend's `subject`)
 * can still get real drill picks without needing to resolve a name first.
 */
export async function drillPicksFor(subject: { memberId: string }): Promise<DrillPick[]> {
  const [workOn, rotationSeed] = await Promise.all([
    fetchWorkOn(subject.memberId),
    getActiveSessionId(),
  ]);
  return recommendDrills({ workOn, level: null, rotationSeed });
}
