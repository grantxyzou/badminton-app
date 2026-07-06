import type { BirdPurchase, BirdUsage, Session } from './types';

/**
 * Reads the bird usages off a session document, tolerating both the
 * legacy single-object shape (`birdUsage`) and the current array shape
 * (`birdUsages`). Always returns an array. Never mutates the input.
 *
 * Writes should always go through the `birdUsages` array — the legacy
 * field is read-only and will be dropped the next time a session is saved.
 */
export function normalizeBirdUsages(
  session: Pick<Session, 'birdUsage' | 'birdUsages'> | null | undefined,
): BirdUsage[] {
  if (!session) return [];
  if (Array.isArray(session.birdUsages)) return session.birdUsages;
  const legacy = session.birdUsage;
  if (legacy && typeof legacy === 'object' && typeof legacy.tubes === 'number') {
    return [legacy];
  }
  return [];
}

export function totalTubes(usages: BirdUsage[]): number {
  return usages.reduce((sum, u) => sum + (u.tubes ?? 0), 0);
}

export function totalBirdCost(usages: BirdUsage[]): number {
  const raw = usages.reduce((sum, u) => sum + (u.totalBirdCost ?? 0), 0);
  return Math.round(raw * 100) / 100;
}

/**
 * Build the authoritative `BirdUsage` snapshot for one purchase + tube count.
 * The SINGLE source of the per-entry cost formula — `PUT /api/session`,
 * `PATCH /api/session/bird-usage`, and `POST /api/session/advance` all write
 * through this, so the snapshot shape and rounding can't drift between the
 * three write paths (each previously inlined its own copy).
 */
export function snapshotBirdUsage(
  purchase: Pick<BirdPurchase, 'id' | 'name' | 'costPerTube'>,
  tubes: number,
): BirdUsage {
  return {
    purchaseId: purchase.id,
    purchaseName: purchase.name,
    tubes,
    costPerTube: purchase.costPerTube,
    totalBirdCost: Math.round(tubes * purchase.costPerTube * 100) / 100,
  };
}

/**
 * Apply a single-purchase tube edit to a session's full usage map WITHOUT
 * dropping the other purchases. Returns the `{ purchaseId, tubes }` array that
 * `PUT /api/session` accepts (the server re-derives cost from the purchase).
 *
 * SetupPage's single-purchase tube editor used to overwrite the whole
 * `birdUsages` array with just the one edited entry, silently collapsing a
 * session that legitimately carried tubes from ≥2 purchases (assignable via
 * BirdsPage's AssignUsageSheet) down to one — understating cost. Merging
 * against the loaded `originalSessionTubes` map preserves the untouched entries.
 *
 * - `editedTubes > 0`  → set/replace that purchase's entry
 * - `editedTubes <= 0` → remove that purchase's entry
 * - `editedPurchaseId === null` → no edit; the original map is returned as-is
 *
 * Does not mutate `original`.
 */
export function mergeBirdUsageEdit(
  original: Map<string, number>,
  editedPurchaseId: string | null,
  editedTubes: number,
): { purchaseId: string; tubes: number }[] {
  const merged = new Map(original);
  if (editedPurchaseId) {
    if (editedTubes > 0) merged.set(editedPurchaseId, editedTubes);
    else merged.delete(editedPurchaseId);
  }
  return Array.from(merged, ([purchaseId, tubes]) => ({ purchaseId, tubes }));
}

/**
 * Sums tubes used across the given sessions. Accepts either full sessions
 * (reads via `normalizeBirdUsages`) or already-normalized usage arrays.
 */
export function tubesUsedAcross(sessions: Array<Pick<Session, 'birdUsage' | 'birdUsages'>>): number {
  let sum = 0;
  for (const s of sessions) {
    for (const u of normalizeBirdUsages(s)) sum += u.tubes ?? 0;
  }
  return Math.round(sum * 10) / 10;
}

/**
 * Average tubes used per session over the most recent `window` sessions
 * that actually had bird usage recorded. Sessions with zero tubes are
 * excluded from the denominator (they'd drag the average toward zero and
 * make the runway overly optimistic).
 */
export function avgTubesPerSession(
  sessions: Array<Pick<Session, 'birdUsage' | 'birdUsages'>>,
  window = 8,
): number {
  const perSession = sessions
    .map((s) => {
      const tubes = normalizeBirdUsages(s).reduce((sum, u) => sum + (u.tubes ?? 0), 0);
      return tubes;
    })
    .filter((t) => t > 0)
    .slice(-window);
  if (perSession.length === 0) return 0;
  const sum = perSession.reduce((a, b) => a + b, 0);
  return Math.round((sum / perSession.length) * 10) / 10;
}

/**
 * Runway in weeks at the current usage pace. Assumes one session per week
 * (matches the app's cadence — one session per weekly friend game). Returns
 * Infinity when avg is zero and there's still stock (nothing to deplete);
 * 0 when stock is zero.
 */
export function runwayWeeks(remainingTubes: number, avgPerSession: number): number {
  if (remainingTubes <= 0) return 0;
  if (avgPerSession <= 0) return Infinity;
  return Math.round((remainingTubes / avgPerSession) * 10) / 10;
}
