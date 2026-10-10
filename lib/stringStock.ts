import { randomBytes } from 'crypto';
import { ensureContainer, getContainer } from './cosmos';
import { ensureCatalogSeeded } from './catalogSeed';
import { groupScope, type GroupScope } from './groupScope';
import type { CatalogItem, StringPurchase } from './types';

export * from './stringStockMath';
import { MAX_UNITS, MAX_METRES_PER_UNIT, MAX_COST_CENTS } from './stringStockMath';

/**
 * STRING INVENTORY — what the club bought, what went onto rackets, what it
 * cost (docs/plans/string-inventory.md). The string half of what `birds`
 * does for shuttles, with one difference that shapes everything here:
 * USAGE IS NOT LOGGED, IT IS COUNTED. A job whose string has gone in
 * (`strung`, `ready`, `picked_up`) is one set of the string its label
 * names, so the stock figure is purchases minus jobs, matched by label.
 *
 * Metres are the unit: a reel is 200 m, a set 10 m, a job is one set. The
 * catalog's `reelLengthM` / `setLengthM` prefill those for a linked string;
 * `SET_M` is the fallback for a string the catalog does not know.
 *
 * Cost per set is the LATEST purchase's cost per metre × the set length,
 * the same "current price" rule `currentPricePerTube` uses for shuttles —
 * so "what the string on that racket cost" is what it would cost to replace,
 * not an average over years of reels.
 */

/** The string catalog by id (GLOBAL container, seeded — not club data). */
export async function readStringCatalog(): Promise<Map<string, CatalogItem>> {
  await ensureCatalogSeeded();
  const { resources } = await getContainer('equipmentCatalog').items
    .query<CatalogItem>({ query: 'SELECT * FROM c WHERE c.category = @category', parameters: [{ name: '@category', value: 'string' }] })
    .fetchAll();
  return new Map(resources.filter((r) => r.category === 'string').map((r) => [r.id, r]));
}

// ── Storage ────────────────────────────────────────────────────────────────

let ready: Promise<void> | null = null;
export function ensureStringStock(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('stringStock', '/id').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

export async function readStringPurchases(scope: GroupScope): Promise<StringPurchase[]> {
  await ensureStringStock();
  const rows = await scope.query<StringPurchase & { kind?: string }>('stringStock', { where: "c.kind = 'purchase'" });
  return rows.filter((r) => r.kind === 'purchase').sort((a, b) => (a.date + a.createdAt < b.date + b.createdAt ? 1 : -1));
}

export class StringStockError extends Error {
  constructor(public readonly code: 'invalid_label' | 'invalid_units' | 'invalid_metres' | 'invalid_cost' | 'invalid_date' | 'not_found') {
    super(code);
  }
}

export interface NewStringPurchase {
  label: string;
  catalogId?: string | null;
  unit: StringPurchase['unit'];
  units: number;
  metresPerUnit: number;
  totalCostCents: number;
  date: string;
  notes?: string;
}

export function validatePurchase(input: Record<string, unknown>): NewStringPurchase {
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 60) : '';
  if (!label) throw new StringStockError('invalid_label');
  const unit = input.unit === 'reel' ? 'reel' : input.unit === 'set' ? 'set' : null;
  const units = input.units;
  if (!unit || typeof units !== 'number' || !Number.isInteger(units) || units <= 0 || units > MAX_UNITS) throw new StringStockError('invalid_units');
  const metresPerUnit = input.metresPerUnit;
  if (typeof metresPerUnit !== 'number' || !Number.isFinite(metresPerUnit) || metresPerUnit <= 0 || metresPerUnit > MAX_METRES_PER_UNIT) throw new StringStockError('invalid_metres');
  const totalCostCents = input.totalCostCents;
  if (typeof totalCostCents !== 'number' || !Number.isInteger(totalCostCents) || totalCostCents < 0 || totalCostCents > MAX_COST_CENTS) throw new StringStockError('invalid_cost');
  const date = typeof input.date === 'string' ? input.date : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new StringStockError('invalid_date');
  const catalogId = typeof input.catalogId === 'string' && input.catalogId.startsWith('string-') ? input.catalogId : null;
  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 200) : undefined;
  return { label, catalogId, unit, units, metresPerUnit: Math.round(metresPerUnit * 10) / 10, totalCostCents, date, ...(notes ? { notes } : {}) };
}

export async function logStringPurchase(groupId: string, input: NewStringPurchase, adminId: string): Promise<StringPurchase> {
  await ensureStringStock();
  const doc: StringPurchase = {
    id: `sp-${randomBytes(8).toString('hex')}`,
    kind: 'purchase',
    label: input.label,
    ...(input.catalogId ? { catalogId: input.catalogId } : {}),
    unit: input.unit,
    units: input.units,
    metresPerUnit: input.metresPerUnit,
    totalCostCents: input.totalCostCents,
    date: input.date,
    ...(input.notes ? { notes: input.notes } : {}),
    createdAt: new Date().toISOString(),
    createdBy: adminId,
  };
  return groupScope(groupId).create<StringPurchase>('stringStock', doc);
}

export async function deleteStringPurchase(groupId: string, id: string): Promise<StringPurchase> {
  await ensureStringStock();
  const scope = groupScope(groupId);
  const existing = await scope.read<StringPurchase>('stringStock', id);
  if (!existing || existing.kind !== 'purchase') throw new StringStockError('not_found');
  await scope.remove('stringStock', id);
  return existing;
}
