import { getContainer } from './cosmos';
import { snapshotBirdUsage, validateBirdEntry } from './birdUsages';
import type { BirdUsage } from './types';

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

  const byId = new Map<string, number>();
  for (const entry of raw) {
    const v = validateBirdEntry(entry);
    if (!v.ok) return { ok: false, status: 400, error: v.error };
    byId.set(v.value.purchaseId, v.value.tubes); // last occurrence wins
  }

  const wanted = [...byId].filter(([, tubes]) => tubes > 0); // 0 = remove/omit
  if (wanted.length === 0) return { ok: true, usages: [] };

  const birds = getContainer('birds');
  const reads = await Promise.all(wanted.map(([id]) => birds.item(id, id).read()));
  const usages: BirdUsage[] = [];
  for (let i = 0; i < wanted.length; i++) {
    const purchase = reads[i].resource;
    if (!purchase) return { ok: false, status: 404, error: 'Selected bird purchase not found' };
    usages.push(snapshotBirdUsage(purchase, wanted[i][1]));
  }
  return { ok: true, usages };
}
