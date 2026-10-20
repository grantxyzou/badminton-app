import catalogSeed from '../scripts/data/equipment-catalog.json';
import { groupDocId, groupScope, type GroupScope } from './groupScope';
import { ensureClubSettings } from './stringingShop';
import { MAX_HOLES, MIN_HOLES, grommetHoles } from './stringPatterns';
import type { CatalogItem } from './types';

/**
 * A grommet hole count the club's stringer took off a frame on the machine
 * (`docs/plans/grommet-holes.md`, Phase 3). The route for the rackets no maker
 * page or pattern sheet could answer for — all of Li-Ning, and the blanks in
 * Yonex and Victor.
 *
 * Stored per CLUB, as a `kind: 'holeCount'` row in `clubSettings` (Grant,
 * 2026-10-20): one club's admin can never change what another club's members
 * read, and another club's stringer counts their own. One row per racket
 * model, id `holes:<catalogId>` (prefixed for any group but BPM).
 *
 * A count is offered only where no sourced count exists. A stringer's count
 * for a frame Yonex or Victor already answers for would be a second opinion
 * with nobody to settle it; refusing it keeps the frame page saying one thing.
 */

export const HOLE_COUNT_KIND = 'holeCount';

export interface HoleCountDoc {
  id: string;
  kind: typeof HOLE_COUNT_KIND;
  catalogId: string;
  holes: number;
  countedAt: string;
  countedBy: string;
  groupId?: string;
}

export function holeCountDocId(groupId: string, catalogId: string): string {
  return groupDocId(groupId, `holes:${catalogId}`);
}

// The seed file is what the frame page reads `stringPattern` from too, so a
// count is judged against the same answer the member sees. A find over ~160
// rows, not a module-level Map (`single-instance-registry` would flag one).
const SEED = (catalogSeed as unknown as { items: CatalogItem[] }).items;
const racketById = (id: string) => SEED.find((i) => i.category === 'racket' && i.id === id);

export class HoleCountError extends Error {
  constructor(public readonly code: 'invalid_racket' | 'invalid_holes' | 'already_known' | 'not_found') {
    super(code);
  }
}

/** Throws unless `catalogId` is a racket with no sourced count and `holes` a whole number in range. */
export function validateHoleCount(catalogId: unknown, holes: unknown): { catalogId: string; holes: number } {
  if (typeof catalogId !== 'string') throw new HoleCountError('invalid_racket');
  const racket = racketById(catalogId);
  if (!racket) throw new HoleCountError('invalid_racket');
  if (grommetHoles(racket) !== null) throw new HoleCountError('already_known');
  if (typeof holes !== 'number' || !Number.isInteger(holes) || holes < MIN_HOLES || holes > MAX_HOLES) {
    throw new HoleCountError('invalid_holes');
  }
  return { catalogId, holes };
}

/** The club's counts, by catalog id. */
export async function readHoleCounts(scope: GroupScope): Promise<Record<string, number>> {
  await ensureClubSettings();
  // A literal, like `readStringPurchases`: the mock store filters by parameter
  // NAME and knows no `@kind`, so a parameter would read as "no filter" there.
  const rows = await scope.query<HoleCountDoc>('clubSettings', { where: `c.kind = '${HOLE_COUNT_KIND}'` });
  const out: Record<string, number> = {};
  for (const r of rows) {
    // Re-checked in JS: a count for a racket that has since gained a sourced
    // one (a catalog update) gives way to the source, so the page never shows two.
    if (r.kind !== HOLE_COUNT_KIND || typeof r.holes !== 'number') continue;
    const racket = racketById(r.catalogId);
    if (!racket || grommetHoles(racket) !== null) continue;
    out[r.catalogId] = r.holes;
  }
  return out;
}

/** Sets (or corrects) the club's count for one racket model. */
export async function setHoleCount(groupId: string, catalogId: string, holes: number, memberId: string): Promise<HoleCountDoc> {
  await ensureClubSettings();
  const doc: HoleCountDoc = {
    id: holeCountDocId(groupId, catalogId),
    kind: HOLE_COUNT_KIND,
    catalogId,
    holes,
    countedAt: new Date().toISOString(),
    countedBy: memberId,
  };
  // A whole-value set, not a read-modify-write: nothing on the row survives
  // from before, so `upsert` cannot resurrect anything that matters.
  return groupScope(groupId).upsert<HoleCountDoc>('clubSettings', doc);
}

export async function clearHoleCount(groupId: string, catalogId: string): Promise<void> {
  await ensureClubSettings();
  const scope = groupScope(groupId);
  const id = holeCountDocId(groupId, catalogId);
  // `clubSettings` is a shared cabinet: check the kind before removing by id.
  const existing = await scope.read<HoleCountDoc>('clubSettings', id);
  if (!existing || existing.kind !== HOLE_COUNT_KIND) throw new HoleCountError('not_found');
  await scope.remove('clubSettings', id);
}
