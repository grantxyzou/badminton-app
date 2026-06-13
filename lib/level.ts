/**
 * Canonical skill level — one accurate, explainable number per member.
 *
 * Pure module (no I/O) so it unit-tests directly and is reused by the API route,
 * the insight narrator, and (later) the gear recommender. Computed on read by
 * folding data that already exists (self-assessment snapshots now; game
 * calibration + peer in later phases). No materialized rating doc, no job.
 *
 * Scale: `level` is 1–5 (the self-assessment scale, `lib/assessment.ts`). It is
 * the canonical headline. `stage` (1–6) is a BRIDGE for the gear recommender,
 * which matches against catalog `skillRange` on a 1–6 axis — see `levelToStage`.
 *
 * Blend (forward-compatible — later phases just light up terms):
 *   w_self = 0.5
 *   w_game = 0.3 × min(1, gamesLast180d / 10)   (Phase 2)
 *   w_peer = 0.2 × min(1, ratersLast180d / 3)   (Phase 5)
 *   level  = Σ(wᵢ × componentᵢ) / Σ(wᵢ)          over PRESENT components only
 * Missing sources are omitted and the weights renormalized. With no sources we
 * fall back to `stageToLevel(Member.stage)` at low confidence; with no stage
 * either, `level` is null (take a check-in).
 */

import { placePhase, type Phase } from './assessment';

export interface LevelInputs {
  /** Self-assessment snapshots (may be unsorted). Phase 1 reads the latest
   *  non-null `overall`; Phase 3 swaps in a smoothed value. */
  selfSnapshots: { takenAt: string; overall: number | null }[];
  /** Phase 2 — game-calibrated observed level + volume. */
  gameCalibration?: { observedLevel: number; games: number; lastGameAt: string | null } | null;
  /** Phase 5 — peer-rating aggregate. */
  peerLevel?: { median: number; raters: number } | null;
  /** `Member.stage` (1–6). Fallback input only, never written. */
  legacyStage?: number | null;
  /** Injected for deterministic staleness math. ISO 8601. */
  now: string;
}

export interface CanonicalLevel {
  /** 1–5, one decimal — the canonical headline. Null when there's nothing to go on. */
  level: number | null;
  /** 1–6 bridge for gear `skillRange` / stage consumers. */
  stage: number | null;
  /** Reuses the self-assessment phase bands. */
  phase: Phase | null;
  confidence: 'low' | 'medium' | 'high';
  /** What each source contributed (null = not present), for transparency. */
  basis: { self: number | null; game: number | null; peer: number | null; legacyStage: number | null };
  /** Human-readable lines rendered under "How this is calculated". */
  explanation: string[];
  computedAt: string;
}

const STALE_DAYS = 180;
const round1 = (n: number) => Math.round(n * 10) / 10;
const clampLevel = (n: number) => Math.min(5, Math.max(1, n));
const clampStage = (n: number) => Math.min(6, Math.max(1, n));

/** Level (1–5) → stage (1–6). Each self-assessment phase boundary ≈ +1 stage. */
export function levelToStage(level: number): number {
  return clampStage(Math.round(1 + (clampLevel(level) - 1) * 1.25));
}

/** Stage (1–6) → level (1–5). Inverse-ish of `levelToStage`, used for the
 *  legacy-stage fallback seed. */
export function stageToLevel(stage: number): number {
  return round1(clampLevel(1 + (clampStage(stage) - 1) * 0.8));
}

/** Latest snapshot with a non-null `overall`, by `takenAt`. */
function latestSelf(snapshots: { takenAt: string; overall: number | null }[]): { takenAt: string; overall: number } | null {
  const sorted = snapshots
    .filter((s) => s && typeof s.takenAt === 'string' && typeof s.overall === 'number')
    .slice()
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const latest = sorted[sorted.length - 1];
  return latest ? { takenAt: latest.takenAt, overall: latest.overall as number } : null;
}

function ageDays(fromIso: string, nowIso: string): number {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(from) || Number.isNaN(now)) return 0;
  return (now - from) / 86_400_000;
}

const NOTCH_DOWN: Record<CanonicalLevel['confidence'], CanonicalLevel['confidence']> = {
  high: 'medium',
  medium: 'low',
  low: 'low',
};

/**
 * Derive the canonical level from whatever sources are present. The blend is
 * forward-compatible: Phase 1 only ever passes self + legacyStage, so the game
 * and peer terms stay null and renormalize away.
 */
export function deriveLevel(inputs: LevelInputs): CanonicalLevel {
  const { selfSnapshots, gameCalibration, peerLevel, legacyStage, now } = inputs;
  const explanation: string[] = [];

  const self = latestSelf(selfSnapshots ?? []);
  const selfLevel = self?.overall ?? null;
  const gameLevel = gameCalibration ? clampLevel(gameCalibration.observedLevel) : null;
  const peerLevelVal = peerLevel ? clampLevel(peerLevel.median) : null;

  // Weighted blend over present components.
  const terms: { value: number; weight: number }[] = [];
  if (selfLevel !== null) terms.push({ value: selfLevel, weight: 0.5 });
  if (gameLevel !== null && gameCalibration) {
    terms.push({ value: gameLevel, weight: 0.3 * Math.min(1, gameCalibration.games / 10) });
  }
  if (peerLevelVal !== null && peerLevel) {
    terms.push({ value: peerLevelVal, weight: 0.2 * Math.min(1, peerLevel.raters / 3) });
  }
  const usable = terms.filter((t) => t.weight > 0);
  const totalWeight = usable.reduce((s, t) => s + t.weight, 0);

  const basis = {
    self: selfLevel !== null ? round1(selfLevel) : null,
    game: gameLevel !== null ? round1(gameLevel) : null,
    peer: peerLevelVal !== null ? round1(peerLevelVal) : null,
    legacyStage: typeof legacyStage === 'number' ? legacyStage : null,
  };

  // No usable measured sources → fall back to the legacy stage, else null.
  if (totalWeight === 0) {
    if (typeof legacyStage === 'number') {
      const level = stageToLevel(legacyStage);
      explanation.push('Estimated from your saved skill stage — take a check-in to make this yours.');
      return {
        level,
        stage: levelToStage(level),
        phase: placePhase(level),
        confidence: 'low',
        basis,
        explanation,
        computedAt: now,
      };
    }
    explanation.push('Take a skill check-in to see your level.');
    return { level: null, stage: null, phase: null, confidence: 'low', basis, explanation, computedAt: now };
  }

  const level = round1(clampLevel(usable.reduce((s, t) => s + t.value * t.weight, 0) / totalWeight));

  // Confidence from the strength of evidence, then docked for staleness.
  let confidence: CanonicalLevel['confidence'] =
    (selfSnapshots?.filter((s) => typeof s.overall === 'number').length ?? 0) >= 2 ? 'high' : 'medium';
  if (gameLevel !== null) confidence = 'high';

  if (self && ageDays(self.takenAt, now) > STALE_DAYS) {
    confidence = NOTCH_DOWN[confidence];
    explanation.push('Your last check-in was over 6 months ago — refresh it to sharpen this.');
  }

  // Narration of what fed the number.
  if (basis.self !== null) {
    const count = selfSnapshots.filter((s) => typeof s.overall === 'number').length;
    explanation.unshift(
      count > 1
        ? `From your self check-ins (latest ${basis.self.toFixed(1)} / 5, ${count} on record).`
        : `From your self check-in (${basis.self.toFixed(1)} / 5).`,
    );
  }
  if (basis.game !== null && gameCalibration) {
    explanation.push(`Adjusted by your logged games (${gameCalibration.games} game${gameCalibration.games === 1 ? '' : 's'}).`);
  }
  if (basis.peer !== null) explanation.push('Includes how regular partners see your play.');

  return {
    level,
    stage: levelToStage(level),
    phase: placePhase(level),
    confidence,
    basis,
    explanation,
    computedAt: now,
  };
}
