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

import { placePhase, PHASE_BANDS, type Phase } from './assessment';
import { blindSpot, type BlindSpot } from './calibration';

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
  /** Phase 3 — when true, the self component is a time-decayed EWMA of all
   *  snapshots (not just the latest) and the phase is the hysteresis-confirmed
   *  trajectory phase rather than a raw band lookup. Gated by
   *  `NEXT_PUBLIC_FLAG_SKILL_SMOOTHING` at the store. */
  smoothing?: boolean;
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
  /** Self-vs-observed gap from game calibration (Phase 2). Null until there are
   *  enough games; asymmetrically gated. The card reveals it only on opt-in and
   *  never prints the deficit number for the 'below' direction. */
  blindSpot?: BlindSpot | null;
  /** Phase 3 — a higher phase the latest check-in reached but that hysteresis
   *  hasn't confirmed yet. Drives the "on track for X — confirm next check-in"
   *  hint. Null when the confirmed phase is already current or smoothing is off. */
  pendingPromotion?: Phase | null;
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

// ── Phase 3: stability (smoothing + phase hysteresis) ──

/** EWMA half-life, in days: a snapshot's weight halves every 90 days of age. */
const SMOOTH_HALF_LIFE_DAYS = 90;
/** A pending promotion is confirmed early if a game-calibrated level lands
 *  within this much of the target band minimum (with enough games). */
const PROMOTE_CORROBORATION = 0.2;
/** Demotion only fires once the smoothed level falls this far below the current
 *  band minimum — sticky edges, so a 3.38 after a 3.45 doesn't bounce a phase. */
const DEMOTE_MARGIN = 0.15;
/** Games required before a calibrated level may corroborate a promotion. */
const CORROBORATION_MIN_GAMES = 8;

function validSorted(snapshots: { takenAt: string; overall: number | null }[]): { takenAt: string; overall: number }[] {
  return (snapshots ?? [])
    .filter((s) => s && typeof s.takenAt === 'string' && typeof s.overall === 'number')
    .map((s) => ({ takenAt: s.takenAt, overall: s.overall as number }))
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

/** Time-decayed EWMA of all snapshots, anchored at `anchorIso` (defaults to the
 *  newest snapshot). Recent check-ins dominate; old ones fade but are never
 *  discarded. A single snapshot returns its own value (weights cancel). */
export function smoothSelfLevel(
  snapshots: { takenAt: string; overall: number | null }[],
  now: string,
): number | null {
  const pts = validSorted(snapshots);
  if (pts.length === 0) return null;
  const anchor = pts[pts.length - 1].takenAt;
  let sumW = 0;
  let sumWV = 0;
  for (const p of pts) {
    const w = Math.pow(0.5, ageDays(p.takenAt, anchor) / SMOOTH_HALF_LIFE_DAYS);
    sumW += w;
    sumWV += w * p.overall;
  }
  // `now` is accepted for signature symmetry with deriveLevel; anchoring at the
  // newest snapshot (not `now`) keeps the blend value independent of how long
  // ago the last check-in was — staleness is handled by confidence docking.
  void now;
  return sumW > 0 ? round1(clampLevel(sumWV / sumW)) : null;
}

/** Band minimum for a phase (1.0 if somehow unknown). */
function bandMin(phase: Phase | null): number {
  if (!phase) return 1.0;
  const band = PHASE_BANDS.find((b) => b.phase === phase);
  return band ? band.min : 1.0;
}

export interface PhaseTrajectory {
  /** The hysteresis-confirmed phase. */
  phase: Phase | null;
  /** A higher band the latest check-in reached but that isn't confirmed yet. */
  pendingPromotion: Phase | null;
}

/**
 * Confirmed phase + pending promotion, derived by folding the snapshot history
 * chronologically — stateless and reproducible (no stored "previous phase").
 *
 * Rules:
 *  - The first check-in establishes a baseline phase with no hysteresis.
 *  - **Promotion** to a higher band needs corroboration: either two consecutive
 *    check-ins whose smoothed level reaches the band, OR one such check-in
 *    backed by a game-calibrated level within `PROMOTE_CORROBORATION` of the
 *    band minimum (≥ `CORROBORATION_MIN_GAMES` games). Until then the band is
 *    `pendingPromotion`, not `phase`.
 *  - **Demotion** only once the smoothed level drops below `bandMin − DEMOTE_MARGIN`.
 *
 * `gameCorroboration` is the member's CURRENT observed calibration; it can only
 * confirm a promotion the latest check-in is already pending (we don't have a
 * historical observed level per snapshot, and "current games confirm the current
 * pending promotion" is exactly the intended use).
 */
export function resolvePhaseTrajectory(
  snapshots: { takenAt: string; overall: number | null }[],
  gameCorroboration?: { level: number; games: number } | null,
): PhaseTrajectory {
  const pts = validSorted(snapshots);
  if (pts.length === 0) return { phase: null, pendingPromotion: null };

  /** Prefix EWMA anchored at pts[idx] — the smoothed level "as of" that check-in. */
  const smoothedAt = (idx: number): number => {
    const anchor = pts[idx].takenAt;
    let sumW = 0;
    let sumWV = 0;
    for (let j = 0; j <= idx; j++) {
      const w = Math.pow(0.5, ageDays(pts[j].takenAt, anchor) / SMOOTH_HALF_LIFE_DAYS);
      sumW += w;
      sumWV += w * pts[j].overall;
    }
    return sumW > 0 ? sumWV / sumW : pts[idx].overall;
  };

  let confirmed = placePhase(smoothedAt(0));
  let prevQualifying: Phase | null = null;
  let pending: Phase | null = null;

  for (let i = 0; i < pts.length; i++) {
    const sm = smoothedAt(i);
    const target = placePhase(sm);
    const targetMin = bandMin(target);
    const confirmedMin = bandMin(confirmed);

    if (targetMin > confirmedMin) {
      // Candidate promotion: confirm on a second consecutive qualifying check-in.
      if (prevQualifying === target) {
        confirmed = target;
        prevQualifying = null;
        pending = null;
      } else {
        prevQualifying = target;
        pending = target;
      }
    } else if (sm < confirmedMin - DEMOTE_MARGIN) {
      // Sticky demotion.
      confirmed = placePhase(sm);
      prevQualifying = null;
      pending = null;
    } else {
      // Same band (or within the sticky demotion margin) — no change.
      prevQualifying = null;
      pending = null;
    }
  }

  // The current observed calibration can confirm a still-pending promotion.
  if (
    pending &&
    gameCorroboration &&
    gameCorroboration.games >= CORROBORATION_MIN_GAMES &&
    gameCorroboration.level >= bandMin(pending) - PROMOTE_CORROBORATION
  ) {
    confirmed = pending;
    pending = null;
  }

  return { phase: confirmed, pendingPromotion: pending };
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
  const latestSelfLevel = self?.overall ?? null;
  // Phase 3: the self component switches from the latest overall to a smoothed
  // EWMA. `latestSelfLevel` is still used for the blind-spot (perception vs
  // games) and staleness so Phase 2 behaviour is unchanged when smoothing is off.
  const smoothedSelf = inputs.smoothing ? smoothSelfLevel(selfSnapshots ?? [], now) : null;
  const selfLevel = inputs.smoothing ? smoothedSelf : latestSelfLevel;
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
    if (inputs.smoothing && count > 1) {
      explanation.unshift(`From your self check-ins (recent average ${basis.self.toFixed(1)} / 5, ${count} on record).`);
    } else {
      explanation.unshift(
        count > 1
          ? `From your self check-ins (latest ${basis.self.toFixed(1)} / 5, ${count} on record).`
          : `From your self check-in (${basis.self.toFixed(1)} / 5).`,
      );
    }
  }
  if (basis.game !== null && gameCalibration) {
    explanation.push(`Adjusted by your logged games (${gameCalibration.games} game${gameCalibration.games === 1 ? '' : 's'}).`);
  }
  if (basis.peer !== null) explanation.push('Includes how regular partners see your play.');

  // The self-vs-observed gap, computed from the latest self RATING (perception)
  // vs the observed game level (asymmetric gating lives in `blindSpot`). Uses the
  // latest rating — not the smoothed value — because the gap is about what the
  // player believes right now. Always available to the owner; the card chooses
  // whether/how to reveal it.
  const bs = gameCalibration ? blindSpot(latestSelfLevel, gameCalibration) : null;

  // Phase 3: hysteresis-confirmed phase + pending promotion. Off → raw band.
  let phase: Phase | null = placePhase(level);
  let pendingPromotion: Phase | null = null;
  if (inputs.smoothing) {
    const gameCorroboration = gameCalibration
      ? { level: clampLevel(gameCalibration.observedLevel), games: gameCalibration.games }
      : null;
    const traj = resolvePhaseTrajectory(selfSnapshots ?? [], gameCorroboration);
    if (traj.phase) phase = traj.phase;
    pendingPromotion = traj.pendingPromotion;
    if (pendingPromotion) {
      explanation.push(
        `Your check-ins are reaching the ${pendingPromotion} phase — one more consistent check-in locks it in.`,
      );
    }
  }

  return {
    level,
    stage: levelToStage(level),
    phase,
    confidence,
    basis,
    explanation,
    blindSpot: bs,
    pendingPromotion,
    computedAt: now,
  };
}
