/**
 * Non-obvious insight signals — the engine behind the distributed AI insights.
 *
 * The product bar (owner, 2026-06-17) is "value BEYOND the obvious": an insight
 * must surface a pattern the player hasn't already noticed on the card, never a
 * restatement of a number they can see. That bar is a content/grounding problem,
 * so the *surprising angles* are computed here, deterministically, from data
 * that already exists — and the AI only narrates the strongest one in plain
 * words. This keeps insights grounded (never hallucinated) and unit-testable.
 *
 * Each signal is tagged with the `card` it belongs to and a `score` (0..1
 * notability). A card with no signal above threshold gets nothing — the AI
 * returns null for it and the chip simply doesn't render. Silence beats obvious.
 *
 * Pure module (no I/O). Forward-compatible: the blind-spot signal lights up once
 * game calibration (Phase 2) feeds `canonicalLevel.basis.game`; until then it
 * stays null and the engine just emits the self-only signals.
 */

import { SKILLS, workOnNext, type StoredAssessment, type Phase } from './assessment';
import type { CanonicalLevel } from './level';

const LABEL_BY_KEY = new Map(SKILLS.map((s) => [s.key, s.label]));
const labelOf = (key: string): string => LABEL_BY_KEY.get(key) ?? key;

export type SignalKind = 'blindspot' | 'phase-gating' | 'sticky-weak' | 'improving-streak' | 'declining-streak';
export type SignalCard = 'level' | 'trend' | 'greeting';

export interface InsightSignal {
  kind: SignalKind;
  /** Which card this insight attaches to (greeting = the top synthesis line). */
  card: SignalCard;
  /** 0..1 notability — higher = more worth surfacing. The route picks the
   *  highest-scoring signal per card. */
  score: number;
  /** Grounded facts (numbers/labels) the narrator must stay within — never
   *  invent beyond these. */
  facts: Record<string, string | number>;
  /** A plain-English seed the model rephrases. Never shown to users raw. */
  hint: string;
}

export interface SignalInput {
  /** Self-assessment snapshots (may be unsorted). */
  snapshots: StoredAssessment[];
  /** Canonical level — the blind-spot reads its self-vs-game basis. */
  canonicalLevel?: CanonicalLevel | null;
  now: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Phase bands low→high (mirrors assessment.ts PHASE_BANDS; kept local so this
 *  module stays pure and decoupled). */
const PHASE_ORDER: { phase: Phase; min: number }[] = [
  { phase: 'foundation', min: 1.0 },
  { phase: 'exploration', min: 1.8 },
  { phase: 'switch', min: 2.6 },
  { phase: 'commitment', min: 3.4 },
  { phase: 'advanced', min: 4.3 },
];

function sortedSnapshots(snapshots: StoredAssessment[]): StoredAssessment[] {
  return snapshots
    .filter((d): d is StoredAssessment => !!d && typeof d.takenAt === 'string')
    .slice()
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

/** The lowest-rated skill keys (bottom `n`) in a snapshot. */
function bottomKeys(snap: StoredAssessment, n = 3): string[] {
  const ratings = Array.isArray(snap.ratings) ? snap.ratings : [];
  return workOnNext(ratings, n).map((r) => r.skillKey);
}

/** The next phase above `overall`, and the gap to its band minimum. Null when
 *  already at the top band. */
function nextPhaseGap(overall: number): { nextPhase: Phase; gap: number } | null {
  const next = PHASE_ORDER.find((b) => b.min > overall + 1e-9);
  if (!next) return null;
  return { nextPhase: next.phase, gap: round1(next.min - overall) };
}

/**
 * Compute the candidate non-obvious signals. Returns a flat list; the route
 * groups by `card` and surfaces the highest-scoring one each. An empty list
 * (e.g. a single flat check-in mid-band) is the correct "nothing non-obvious to
 * say" outcome.
 */
export function computeInsightSignals(input: SignalInput): InsightSignal[] {
  const snaps = sortedSnapshots(input.snapshots);
  const signals: InsightSignal[] = [];
  if (snaps.length === 0) return signals;

  const latest = snaps[snaps.length - 1];
  const latestOverall = typeof latest.overall === 'number' ? latest.overall : null;

  // ── Level card: blind-spot (self vs game-observed) ── forward-compatible;
  // only fires once Phase-2 calibration populates basis.game.
  const basis = input.canonicalLevel?.basis;
  if (basis && typeof basis.self === 'number' && typeof basis.game === 'number') {
    const delta = round1(basis.game - basis.self);
    if (Math.abs(delta) >= 0.4) {
      signals.push({
        kind: 'blindspot',
        card: 'level',
        score: Math.min(1, Math.abs(delta) / 1.0),
        facts: { self: basis.self, game: basis.game, delta: Math.abs(delta), direction: delta > 0 ? 'above' : 'below' },
        hint:
          delta > 0
            ? `Your logged games put you ${Math.abs(delta)} above your own check-in rating — you may be underselling yourself.`
            : `Your logged games sit ${Math.abs(delta)} under your check-in rating — recent results haven't caught up to how you rate yourself yet.`,
      });
    }
  }

  // ── Level card: phase-gating ── how close the next phase is, and the lever.
  // Non-obvious: the card shows the phase + overall, never the gap or what
  // would tip it. Only "close" gaps are notable (far ones are noise).
  if (latestOverall !== null) {
    const gating = nextPhaseGap(latestOverall);
    if (gating && gating.gap > 0 && gating.gap <= 0.6) {
      const weakest = workOnNext(Array.isArray(latest.ratings) ? latest.ratings : [], 2);
      const weakLabels = weakest.map((r) => labelOf(r.skillKey)).filter(Boolean);
      signals.push({
        kind: 'phase-gating',
        card: 'level',
        score: 1 - gating.gap / 0.6,
        facts: {
          gap: gating.gap,
          nextPhase: gating.nextPhase,
          ...(weakLabels[0] ? { weakest: weakLabels[0] } : {}),
        },
        hint: `Only ${gating.gap} below the ${gating.nextPhase} band${
          weakLabels.length ? ` — lifting your weakest areas (${weakLabels.join(', ')}) is what would tip you over` : ''
        }.`,
      });
    }
  }

  // ── Trend card: sticky weak skill ── a skill that's stayed in your bottom
  // few across multiple check-ins. The card shows the current work-on list,
  // never its persistence over time.
  if (snaps.length >= 2) {
    const recent = snaps.slice(-3); // up to the last 3 check-ins
    const latestBottom = bottomKeys(latest, 3);
    let bestKey: string | null = null;
    let bestCount = 0;
    let bestValue = Infinity;
    for (const key of latestBottom) {
      if (!key) continue;
      const count = recent.filter((s) => bottomKeys(s, 3).includes(key)).length;
      const ratings = Array.isArray(latest.ratings) ? latest.ratings : [];
      const value = ratings.find((r) => r.skillKey === key)?.value ?? Infinity;
      // Prefer the most-persistent, then the lowest-rated, deterministically.
      if (count > bestCount || (count === bestCount && value < bestValue)) {
        bestKey = key;
        bestCount = count;
        bestValue = value;
      }
    }
    if (bestKey && bestCount >= 2) {
      const label = labelOf(bestKey);
      signals.push({
        kind: 'sticky-weak',
        card: 'trend',
        score: Math.min(1, bestCount / 3),
        facts: { skill: label, count: bestCount, ...(Number.isFinite(bestValue) ? { value: bestValue } : {}) },
        hint: `${label} has stayed among your lowest-rated areas across your last ${bestCount} check-ins — it's the steadiest place to aim.`,
      });
    }
  }

  // ── Greeting: improving / declining streak ── consecutive check-ins moving
  // the same direction. The card shows only the latest delta, never the run.
  if (snaps.length >= 3) {
    const overalls = snaps.map((s) => (typeof s.overall === 'number' ? s.overall : null));
    // Walk back from the latest counting same-direction steps.
    const dirAt = (i: number): number => {
      const a = overalls[i - 1];
      const b = overalls[i];
      if (a === null || b === null) return 0;
      const d = b - a;
      if (d > 0.05) return 1;
      if (d < -0.05) return -1;
      return 0;
    };
    const lastDir = dirAt(overalls.length - 1);
    if (lastDir !== 0) {
      let run = 0;
      for (let i = overalls.length - 1; i >= 1; i--) {
        if (dirAt(i) === lastDir) run += 1;
        else break;
      }
      if (run >= 3) {
        const start = overalls[overalls.length - 1 - run];
        const end = overalls[overalls.length - 1];
        const totalChange = start !== null && end !== null ? round1(Math.abs(end - start)) : 0;
        signals.push({
          kind: lastDir > 0 ? 'improving-streak' : 'declining-streak',
          card: 'greeting',
          score: Math.min(1, run / 4),
          facts: { sessions: run, totalChange },
          hint:
            lastDir > 0
              ? `Quietly on a roll — your overall has climbed ${run} check-ins straight, up ${totalChange} in total.`
              : `Your overall has eased down ${run} check-ins running (${totalChange} total) — worth a fresh, honest re-rate.`,
        });
      }
    }
  }

  return signals;
}

/** Group the flat signal list into the best signal per card. */
export function signalsByCard(signals: InsightSignal[]): Record<SignalCard, InsightSignal | null> {
  const pick = (card: SignalCard): InsightSignal | null =>
    signals.filter((s) => s.card === card).sort((a, b) => b.score - a.score)[0] ?? null;
  return { level: pick('level'), trend: pick('trend'), greeting: pick('greeting') };
}
