import type { CatalogItem, StringingJob, StringPurchase } from './types';

/**
 * The string inventory's ARITHMETIC — client-safe, no I/O (the sheet and
 * the card import the constants and `metresFor`; `lib/stringStock.ts`
 * holds the storage and re-exports everything here). See that file's
 * docblock for the rules; this is the part a test can run on a list.
 */

export const SET_M = 10;
export const REEL_M = 200;
export const MAX_UNITS = 100;
export const MAX_METRES_PER_UNIT = 1000;
export const MAX_COST_CENTS = 500_000;

/** A job's string is on the racket from `strung` on. */
export const STRUNG_STATUSES: ReadonlySet<StringingJob['status']> = new Set(['strung', 'ready', 'picked_up']);

export const labelKey = (label: string) => label.trim().toLowerCase();

export interface StringStockLine {
  label: string;
  catalogId: string | null;
  setMetres: number;
  purchasedMetres: number;
  purchasedCostCents: number;
  purchases: number;
  usedSets: number;
  usedMetres: number;
  remainingMetres: number;
  remainingSets: number;
  /** Null until a purchase has been logged for it. */
  costPerSetCents: number | null;
  /** Sets used × cost per set; null without a price. */
  usedCostCents: number | null;
}

export interface StringStockSummary {
  lines: StringStockLine[];
  /** Jobs whose label matches no offered string, by label. */
  unmatched: Array<{ label: string; usedSets: number }>;
  totals: { purchasedCostCents: number; usedSets: number; usedCostCents: number; remainingValueCents: number };
}

export function summarizeStringStock(input: {
  offered: readonly string[];
  links: Readonly<Record<string, string>>;
  purchases: readonly StringPurchase[];
  jobs: readonly Pick<StringingJob, 'stringLabel' | 'status' | 'archivedAt'>[];
  catalog: ReadonlyMap<string, CatalogItem>;
}): StringStockSummary {
  const byKey = new Map<string, StringStockLine>();
  for (const label of input.offered) {
    const catalogId = input.links[label] ?? null;
    const set = catalogId ? numberAttr(input.catalog.get(catalogId), 'setLengthM') ?? SET_M : SET_M;
    byKey.set(labelKey(label), {
      label, catalogId, setMetres: set,
      purchasedMetres: 0, purchasedCostCents: 0, purchases: 0,
      usedSets: 0, usedMetres: 0, remainingMetres: 0, remainingSets: 0,
      costPerSetCents: null, usedCostCents: null,
    });
  }

  // Latest purchase per string decides the price; purchases sorted by date then createdAt.
  const sorted = input.purchases.slice().sort((a, b) => (a.date + a.createdAt < b.date + b.createdAt ? -1 : 1));
  const latestPerMetre = new Map<string, number>();
  for (const p of sorted) {
    const key = labelKey(p.label);
    let line = byKey.get(key);
    if (!line) {
      // Stock for a string no longer on the offered list still counts; the
      // line is shown so the admin can see where the metres went.
      line = {
        label: p.label, catalogId: p.catalogId ?? null, setMetres: SET_M,
        purchasedMetres: 0, purchasedCostCents: 0, purchases: 0,
        usedSets: 0, usedMetres: 0, remainingMetres: 0, remainingSets: 0,
        costPerSetCents: null, usedCostCents: null,
      };
      byKey.set(key, line);
    }
    const metres = p.units * p.metresPerUnit;
    line.purchasedMetres += metres;
    line.purchasedCostCents += p.totalCostCents;
    line.purchases += 1;
    if (metres > 0) latestPerMetre.set(key, p.totalCostCents / metres);
  }

  const unmatched = new Map<string, { label: string; usedSets: number }>();
  for (const j of input.jobs) {
    if (!STRUNG_STATUSES.has(j.status)) continue;
    const key = labelKey(j.stringLabel ?? '');
    if (!key) continue;
    const line = byKey.get(key);
    if (line) line.usedSets += 1;
    else {
      const u = unmatched.get(key) ?? { label: j.stringLabel.trim(), usedSets: 0 };
      u.usedSets += 1;
      unmatched.set(key, u);
    }
  }

  const lines = [...byKey.values()].map((line) => {
    const key = labelKey(line.label);
    const perMetre = latestPerMetre.get(key);
    const costPerSetCents = perMetre === undefined ? null : Math.round(perMetre * line.setMetres);
    const usedMetres = line.usedSets * line.setMetres;
    const remainingMetres = Math.max(0, line.purchasedMetres - usedMetres);
    return {
      ...line,
      usedMetres,
      remainingMetres,
      remainingSets: Math.floor(remainingMetres / line.setMetres),
      costPerSetCents,
      usedCostCents: costPerSetCents === null ? null : line.usedSets * costPerSetCents,
    };
  });

  const totals = lines.reduce(
    (t, l) => ({
      purchasedCostCents: t.purchasedCostCents + l.purchasedCostCents,
      usedSets: t.usedSets + l.usedSets,
      usedCostCents: t.usedCostCents + (l.usedCostCents ?? 0),
      remainingValueCents: t.remainingValueCents + (l.costPerSetCents === null ? 0 : Math.round((l.remainingMetres / l.setMetres) * l.costPerSetCents)),
    }),
    { purchasedCostCents: 0, usedSets: 0, usedCostCents: 0, remainingValueCents: 0 },
  );
  return { lines, unmatched: [...unmatched.values()].sort((a, b) => b.usedSets - a.usedSets), totals };
}

export function numberAttr(item: CatalogItem | undefined, key: string): number | null {
  const v = item?.attributes?.[key];
  return typeof v === 'number' && v > 0 ? v : null;
}

/** What one unit of a linked string holds, from the catalog; the constants otherwise. */
export function metresFor(unit: StringPurchase['unit'], item: CatalogItem | undefined): number {
  return unit === 'reel' ? numberAttr(item, 'reelLengthM') ?? REEL_M : numberAttr(item, 'setLengthM') ?? SET_M;
}
