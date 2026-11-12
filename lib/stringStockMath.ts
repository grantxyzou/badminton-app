import type { CatalogItem, StringingJob, StringPurchase } from './types';
import { colourIdOf, isStringColourId, STRING_PALETTE, type StringColourId } from './stringPalette';

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

/**
 * A label with its spaces and punctuation gone: "BG-80", "bg 80" and "BG80"
 * are one key. Only a FALLBACK for a job's label (`summarizeStringStock`),
 * and only where it names exactly one shelf string.
 */
export const compactKey = (label: string) => label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export interface StringStockLine {
  label: string;
  catalogId: string | null;
  setMetres: number;
  purchasedMetres: number;
  purchasedCostCents: number;
  purchases: number;
  /** The purchases this line counted, by id: the ONE assignment the bench's
   *  sheet lists and deletes from, so it can never show a purchase another
   *  line's stock was counted from. ADDITIVE on the admin stock read. */
  purchaseIds: string[];
  usedSets: number;
  usedMetres: number;
  remainingMetres: number;
  remainingSets: number;
  /** Null until a purchase has been logged for it. */
  costPerSetCents: number | null;
  /** Sets used × cost per set; null without a price. */
  usedCostCents: number | null;
  /**
   * Per colour, for the colours a purchase was TAGGED with, in palette order
   * (docs/plans/string-stock-by-colour.md). Empty while no purchase of this
   * string carries a colour. ADDITIVE on the admin stock read.
   */
  byColour: StringColourStock[];
  /** Sets left in the untagged ("Mixed / not sure") pool: untagged metres
   *  less every strung job that no tagged colour took. */
  mixedRemainingSets: number;
}

export interface StringColourStock {
  color: StringColourId;
  purchasedMetres: number;
  usedSets: number;
  remainingSets: number;
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
  /**
   * Old spelling → offered label (docs/plans/bench-redesign.md). A purchase
   * or a job under the old spelling counts as the offered string. Nothing is
   * rewritten: an alias whose target is not offered is ignored and the old
   * spelling stands on its own, as it did before the alias.
   */
  aliases?: Readonly<Record<string, string>>;
  purchases: readonly StringPurchase[];
  /** `stringColor` is optional: a job read without it counts in the mixed pool. */
  jobs: readonly Pick<StringingJob, 'stringLabel' | 'status' | 'archivedAt' | 'stringColor'>[];
  catalog: ReadonlyMap<string, CatalogItem>;
}): StringStockSummary {
  const byKey = new Map<string, StringStockLine>();
  // The two pools per line (docs/plans/string-stock-by-colour.md), keyed like
  // `byKey`: metres bought per tagged colour and untagged, and the sets each
  // pool gave up. A job draws from its colour's pool when that colour was
  // bought tagged, from the mixed pool otherwise — never one from another.
  interface Pools { colourMetres: Map<StringColourId, number>; mixedMetres: number; colourUsed: Map<StringColourId, number>; mixedUsed: number }
  const pools = new Map<string, Pools>();
  const poolsOf = (key: string): Pools => {
    let p = pools.get(key);
    if (!p) { p = { colourMetres: new Map(), mixedMetres: 0, colourUsed: new Map(), mixedUsed: 0 }; pools.set(key, p); }
    return p;
  };
  for (const label of input.offered) {
    const catalogId = input.links[label] ?? null;
    const set = catalogId ? numberAttr(input.catalog.get(catalogId), 'setLengthM') ?? SET_M : SET_M;
    byKey.set(labelKey(label), {
      label, catalogId, setMetres: set,
      purchasedMetres: 0, purchasedCostCents: 0, purchases: 0, purchaseIds: [],
      usedSets: 0, usedMetres: 0, remainingMetres: 0, remainingSets: 0,
      costPerSetCents: null, usedCostCents: null,
      byColour: [], mixedRemainingSets: 0,
    });
  }

  // An alias resolves BEFORE keying, for purchases and jobs alike, so both
  // halves of a string's arithmetic agree about which line they belong to.
  const aliasTo = new Map<string, string>();
  for (const [from, to] of Object.entries(input.aliases ?? {})) {
    if (byKey.has(labelKey(to)) && !byKey.has(labelKey(from))) aliasTo.set(labelKey(from), labelKey(to));
  }
  const keyOf = (label: string) => {
    const k = labelKey(label);
    return aliasTo.get(k) ?? k;
  };

  // Latest purchase per string decides the price; purchases sorted by date then createdAt.
  const sorted = input.purchases.slice().sort((a, b) => (a.date + a.createdAt < b.date + b.createdAt ? -1 : 1));
  const latestPerMetre = new Map<string, number>();
  // An offered label is renamed more often than a reel changes: "BG65" on the
  // shelf becomes "Yonex BG65 white" and every purchase logged under the old
  // spelling would read as a different string, leaving the new one "unknown".
  // A purchase carries the catalog row it was bought as, so that finds it.
  // The old spelling then stands for the new one for JOBS too: a racket
  // strung under the old name still used a set of that reel.
  const byCatalog = new Map<string, string>();
  for (const [key, line] of byKey) if (line.catalogId && !byCatalog.has(line.catalogId)) byCatalog.set(line.catalogId, key);
  const renamed = new Map<string, string>();
  for (const p of sorted) {
    const own = keyOf(p.label);
    const moved = !byKey.has(own) && p.catalogId ? byCatalog.get(p.catalogId) : undefined;
    if (moved) renamed.set(own, moved);
    const key = moved ?? own;
    let line = byKey.get(key);
    if (!line) {
      // Stock for a string no longer on the offered list still counts; the
      // line is shown so the admin can see where the metres went.
      line = {
        label: p.label, catalogId: p.catalogId ?? null, setMetres: SET_M,
        purchasedMetres: 0, purchasedCostCents: 0, purchases: 0, purchaseIds: [],
        usedSets: 0, usedMetres: 0, remainingMetres: 0, remainingSets: 0,
        costPerSetCents: null, usedCostCents: null,
        byColour: [], mixedRemainingSets: 0,
      };
      byKey.set(key, line);
    }
    const metres = p.units * p.metresPerUnit;
    line.purchasedMetres += metres;
    line.purchasedCostCents += p.totalCostCents;
    line.purchases += 1;
    line.purchaseIds.push(p.id);
    if (metres > 0) latestPerMetre.set(key, p.totalCostCents / metres);
    const pool = poolsOf(key);
    if (isStringColourId(p.color)) pool.colourMetres.set(p.color, (pool.colourMetres.get(p.color) ?? 0) + metres);
    else pool.mixedMetres += metres;
  }

  // A job's label is free text: the bench fills it from the player's bag,
  // where a catalog string is named "Yonex BG80", while the shelf says "BG80"
  // (2026-11-12, Grant: "the stock is not going down based on the archived
  // and finished stringing job"). Exact label first, then the catalog's names
  // for a linked shelf string, then either with spaces and punctuation gone —
  // each only where it names ONE shelf string, so a fallback never guesses.
  const otherNames = new Map<string, string | null>();
  const claim = (name: string, key: string) => {
    if (!name) return;
    const held = otherNames.get(name);
    otherNames.set(name, held === undefined || held === key ? key : null);
  };
  for (const [key, line] of byKey) {
    claim(`c:${compactKey(line.label)}`, key);
    const item = line.catalogId ? input.catalog.get(line.catalogId) : undefined;
    if (!item) continue;
    for (const name of [`${item.brand} ${item.model}`, item.model]) {
      if (!name?.trim()) continue;
      claim(`l:${labelKey(name)}`, key);
      claim(`c:${compactKey(name)}`, key);
    }
  }
  const byOtherName = (label: string): string | undefined =>
    otherNames.get(`l:${labelKey(label)}`) ?? otherNames.get(`c:${compactKey(label)}`) ?? undefined;

  const unmatched = new Map<string, { label: string; usedSets: number }>();
  for (const j of input.jobs) {
    if (!STRUNG_STATUSES.has(j.status)) continue;
    const own = keyOf(j.stringLabel ?? '');
    if (!own) continue;
    const key = byKey.has(own) ? own : renamed.get(own) ?? byOtherName(j.stringLabel) ?? own;
    const line = byKey.get(key);
    if (line) {
      line.usedSets += 1;
      const pool = poolsOf(key);
      const colour = colourIdOf(j.stringColor);
      if (colour && pool.colourMetres.has(colour)) pool.colourUsed.set(colour, (pool.colourUsed.get(colour) ?? 0) + 1);
      else pool.mixedUsed += 1;
    } else {
      const u = unmatched.get(key) ?? { label: j.stringLabel.trim(), usedSets: 0 };
      u.usedSets += 1;
      unmatched.set(key, u);
    }
  }

  const lines = [...byKey.entries()].map(([lineKey, line]) => {
    const pool = poolsOf(lineKey);
    const setsLeft = (metres: number, used: number) => Math.floor(Math.max(0, metres - used * line.setMetres) / line.setMetres);
    const byColour: StringColourStock[] = STRING_PALETTE.filter((c) => pool.colourMetres.has(c)).map((color) => {
      const purchasedMetres = pool.colourMetres.get(color) ?? 0;
      const usedSets = pool.colourUsed.get(color) ?? 0;
      return { color, purchasedMetres, usedSets, remainingSets: setsLeft(purchasedMetres, usedSets) };
    });
    const mixedRemainingSets = setsLeft(pool.mixedMetres, pool.mixedUsed);
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
      byColour,
      mixedRemainingSets,
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

/**
 * What a PLAYER is told about stock: a band, never sets, metres or cost
 * (docs/design/strings-shelf-spec.md). "Low" is three sets or fewer — a
 * reel is about twenty.
 */
export const LOW_STOCK_SETS = 3;
export type StockBand = 'in' | 'low' | 'out';

/** Null when no purchase has been logged: unknown, never "out". A reel the
 *  stringer has not logged yet would otherwise read as an empty shelf. */
export function stockBand(line: Pick<StringStockLine, 'purchases' | 'remainingSets'>): StockBand | null {
  if (line.purchases === 0) return null;
  if (line.remainingSets === 0) return 'out';
  return line.remainingSets <= LOW_STOCK_SETS ? 'low' : 'in';
}

/**
 * What a PLAYER is told about a string's colours: which are on the shelf,
 * never how many (docs/plans/string-stock-by-colour.md). `null` while no
 * purchase of it carries a colour — then nothing is known per colour, and the
 * request sheet offers the reel's or the maker's list as before. `mixed` says
 * the untagged pool still has sets, which could be any of those colours.
 */
export interface ColourStock {
  inStock: StringColourId[];
  mixed: boolean;
}

export function colourStockOf(line: Pick<StringStockLine, 'byColour' | 'mixedRemainingSets'>): ColourStock | null {
  if (line.byColour.length === 0) return null;
  return {
    inStock: line.byColour.filter((c) => c.remainingSets > 0).map((c) => c.color),
    mixed: line.mixedRemainingSets > 0,
  };
}
