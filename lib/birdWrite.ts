import { getContainer } from './cosmos';
import {
  snapshotBirdUsage,
  snapshotPooledUsage,
  validateBirdEntry,
  validateTubeCount,
  currentPricePerTube,
  POOLED_PURCHASE_ID,
} from './birdUsages';
import type { BirdPurchase, BirdUsage } from './types';

export type ResolveBirdUsagesResult =
  | { ok: true; usages: BirdUsage[] }
  | { ok: false; status: number; error: string };

/**
 * Resolve a raw request `birdUsages` array into authoritative BirdUsage
 * snapshots — the SINGLE shared contract for the array-style write endpoints
 * (`PUT /api/session`, `POST /api/session/advance`), so they can't validate or
 * cost differently:
 *   - each entry validated via `validateBirdEntry` → 400 on bad shape/range/grid
 *   - de-duplicated by purchaseId, last occurrence wins
 *   - `tubes === 0` omits that purchase (Decision: 0 = remove)
 *   - each surviving purchase read from inventory (batched) → 404 if unknown
 *   - cost snapshotted via `snapshotBirdUsage`
 *
 * A non-array input resolves to `[]` (the caller decides whether that means
 * "clear the array" or "leave untouched").
 */
export async function resolveBirdUsages(raw: unknown): Promise<ResolveBirdUsagesResult> {
  if (!Array.isArray(raw)) return { ok: true, usages: [] };

  // A pooled entry (`{ pooled: true, tubes }`) logs shuttles at the current
  // price with no specific batch (Model B). Detected before validateBirdEntry
  // (which requires a purchaseId) and keyed by the POOLED_PURCHASE_ID sentinel,
  // so per-purchase entries and the single pooled bucket coexist in one map.
  const byId = new Map<string, number>();
  for (const entry of raw) {
    if (entry && typeof entry === 'object' && (entry as { pooled?: unknown }).pooled === true) {
      const tubes = Number((entry as { tubes?: unknown }).tubes);
      const err = validateTubeCount(tubes, 0, 100);
      if (err) return { ok: false, status: 400, error: err };
      byId.set(POOLED_PURCHASE_ID, tubes); // last occurrence wins
      continue;
    }
    const v = validateBirdEntry(entry);
    if (!v.ok) return { ok: false, status: 400, error: v.error };
    byId.set(v.value.purchaseId, v.value.tubes); // last occurrence wins
  }

  const wanted = [...byId].filter(([, tubes]) => tubes > 0); // 0 = remove/omit
  if (wanted.length === 0) return { ok: true, usages: [] };

  const pooled = wanted.filter(([id]) => id === POOLED_PURCHASE_ID);
  const perPurchase = wanted.filter(([id]) => id !== POOLED_PURCHASE_ID);
  const birds = getContainer('birds');
  const usages: BirdUsage[] = [];

  // Per-purchase entries (legacy path): read each batch, snapshot at its price.
  if (perPurchase.length > 0) {
    let reads;
    try {
      reads = await Promise.all(perPurchase.map(([id]) => birds.item(id, id).read()));
    } catch {
      // A transient inventory read failure (throttle / network blip) must fail
      // LEGIBLY and retryably — not silently drop bird cost (legible-fail rule)
      // nor bubble an opaque 500. A 404-miss does NOT throw (resource is just
      // undefined), so this only catches genuine read errors.
      return { ok: false, status: 503, error: 'Could not read bird inventory. Please try again.' };
    }
    for (let i = 0; i < perPurchase.length; i++) {
      const purchase = reads[i].resource;
      // Reject unknown ids AND adjustment docs — an adjustment has no costPerTube,
      // so snapshotting one yields NaN cost (CLAUDE.md: never let adjustment docs
      // into bird cost math).
      if (!purchase || purchase.type === 'adjustment') {
        return { ok: false, status: 404, error: 'Selected bird purchase not found' };
      }
      usages.push(snapshotBirdUsage(purchase, perPurchase[i][1]));
    }
  }

  // Pooled entry: snapshot at the current price-per-tube (latest purchase).
  if (pooled.length > 0) {
    let purchases;
    try {
      const { resources } = await birds.items
        .query({ query: 'SELECT c.costPerTube, c.date, c.type FROM c' })
        .fetchAll();
      purchases = (resources as Array<Pick<BirdPurchase, 'costPerTube' | 'date'> & { type?: string }>)
        .filter((d) => d.type !== 'adjustment');
    } catch {
      return { ok: false, status: 503, error: 'Could not read bird inventory. Please try again.' };
    }
    usages.push(snapshotPooledUsage(pooled[0][1], currentPricePerTube(purchases)));
  }

  return { ok: true, usages };
}
