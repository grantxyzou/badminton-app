import type { CatalogItem, FeelBalance, FeelFlex, FeelWeight, GearItem } from './types';

/**
 * "Missing from the catalog": the rackets members typed in by name because the
 * catalog did not have them. Pure; the admin route feeds it.
 *
 * The point is the owner's to-do list: which models to add, how many members
 * each one would help, and what those members said the racket feels like —
 * the three answers the fit engine can already read from a typed racket.
 */

export interface GapDoc {
  memberId?: string;
  items?: GearItem[];
}

export interface CatalogGap {
  /** The first spelling seen, as a member typed it. */
  label: string;
  /** Distinct members with this racket in their bag. */
  count: number;
  /** Their names as this club knows them, sorted. */
  members: string[];
  /** How often each feel answer was given ("don't know" is not counted). */
  feel: {
    balance: Partial<Record<FeelBalance, number>>;
    flex: Partial<Record<FeelFlex, number>>;
    weight: Partial<Record<FeelWeight, number>>;
  };
  /** The closest catalog model by name, as a hint for "is it really missing?".
   *  `likely` when the typed words ARE that model's words (with or without the
   *  brand) — the member probably typed a model the catalog already has. */
  nearest: { id: string; label: string; likely: boolean } | null;
}

/** Words, not punctuation: "Nanoflare-800 LT" and "nanoflare 800lt" share tokens. */
function tokens(s: string): string[] {
  return s.toLowerCase().replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2').split(/[^a-z0-9]+/).filter(Boolean);
}

/** The grouping key: the words in order, so "Nanoflare800" and "nanoflare 800" are one racket. */
const key = (label: string) => tokens(label).join(' ') || label.trim().toLowerCase();

const sameWords = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((w) => b.has(w));

/**
 * The catalog row whose brand + model shares the most words with the typed
 * name, when at least half the typed words match. A hint only — it never
 * decides that a typed racket IS a catalog row.
 */
export function nearestCatalogRow(label: string, catalog: CatalogItem[]): { id: string; label: string; likely: boolean } | null {
  const typed = new Set(tokens(label));
  if (typed.size === 0) return null;
  let best: { id: string; label: string; score: number; likely: boolean } | null = null;
  for (const row of catalog) {
    if (row.category !== 'racket') continue;
    const full = `${row.brand} ${row.model}`;
    const words = new Set(tokens(full));
    let shared = 0;
    for (const w of typed) if (words.has(w)) shared += 1;
    const likely = sameWords(typed, words) || sameWords(typed, new Set(tokens(row.model)));
    const score = likely ? 2 : shared / Math.max(typed.size, words.size);
    if (shared / typed.size >= 0.5 && (!best || score > best.score)) best = { id: row.id, label: full, score, likely };
  }
  return best ? { id: best.id, label: best.label, likely: best.likely } : null;
}

export function catalogGaps(docs: GapDoc[], names: Map<string, string>, catalog: CatalogItem[]): CatalogGap[] {
  const groups = new Map<string, { label: string; memberIds: Set<string>; feel: CatalogGap['feel'] }>();
  for (const doc of docs) {
    const memberId = doc.memberId;
    if (!memberId) continue;
    // One vote per member per name, even with two of the same racket in the bag.
    const seen = new Set<string>();
    for (const item of doc.items ?? []) {
      if (!item || item.retiredAt || item.catalogId || (item.category ?? 'racket') !== 'racket') continue;
      const label = typeof item.label === 'string' ? item.label.trim() : '';
      if (!label) continue;
      const k = key(label);
      let g = groups.get(k);
      if (!g) {
        g = { label, memberIds: new Set(), feel: { balance: {}, flex: {}, weight: {} } };
        groups.set(k, g);
      }
      if (seen.has(k)) continue;
      seen.add(k);
      g.memberIds.add(memberId);
      const feel = item.feel;
      if (feel?.balance) g.feel.balance[feel.balance] = (g.feel.balance[feel.balance] ?? 0) + 1;
      if (feel?.flex) g.feel.flex[feel.flex] = (g.feel.flex[feel.flex] ?? 0) + 1;
      if (feel?.weight) g.feel.weight[feel.weight] = (g.feel.weight[feel.weight] ?? 0) + 1;
    }
  }
  return [...groups.values()]
    .map((g) => ({
      label: g.label,
      count: g.memberIds.size,
      // A member no longer on the roster has no name here, and is left out of
      // the list rather than shown as an id.
      members: [...g.memberIds].map((id) => names.get(id)).filter((n): n is string => !!n).sort((a, b) => a.localeCompare(b)),
      feel: g.feel,
      nearest: nearestCatalogRow(g.label, catalog),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
