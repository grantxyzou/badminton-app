/**
 * The strings shelf, client half (docs/design/strings-shelf-spec.md): reading
 * the `GET /api/stringing/strings` payload, the order strings are shown in,
 * and the fixed DATA colours — a string's type tint and its maker's colours.
 *
 * Client-safe: imports types and `stringingRateCard` (import-free) only.
 * `__tests__/client-server-import-canary.test.ts` holds the line.
 */
import type { CatalogItem } from './types';
import type { StockBand } from './stringStockMath';
import { formatServicePrice } from './stringingRateCard';

export type { StockBand };

export interface Shelf {
  strings: string[];
  links: Record<string, string>;
  /** Label → cents; `null` = "Ask"; a missing label has no price set. */
  prices: Record<string, number | null>;
  /** `null` = the stock read failed; a missing label = unknown. */
  stock: Record<string, StockBand> | null;
  players: Record<string, number>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * An offered label that means "I'll bring my own string" rather than a string
 * on the shelf. Before the request sheet had its own "Bring my own string"
 * row, a club could only offer that by listing it, so an old list can carry
 * one — and the player would then see it twice, the second with no reel,
 * price or stock behind it. The admin still sees the chip to remove it.
 */
const BRING_OWN = /^\s*(bring(ing)?\s+(my|your|their|own)\b|b\.?y\.?o\.?\b|own\s+string\b|自带)/i;
export function isBringOwnLabel(label: string): boolean {
  return BRING_OWN.test(label);
}

/** The payload, or `null` when the list itself is unknown (failed or throttled). */
export function parseShelf(d: unknown): Shelf | null {
  if (!isObj(d) || !Array.isArray(d.strings)) return null;
  const strings = d.strings.filter((s): s is string => typeof s === 'string' && !isBringOwnLabel(s));
  const links: Record<string, string> = {};
  if (isObj(d.links)) for (const [k, v] of Object.entries(d.links)) if (typeof v === 'string') links[k] = v;
  const prices: Record<string, number | null> = {};
  if (isObj(d.prices)) for (const [k, v] of Object.entries(d.prices)) if (v === null || typeof v === 'number') prices[k] = v;
  let stock: Record<string, StockBand> | null = null;
  if (isObj(d.stock)) {
    stock = {};
    for (const [k, v] of Object.entries(d.stock)) if (v === 'in' || v === 'low' || v === 'out') stock[k] = v;
  }
  const players: Record<string, number> = {};
  if (isObj(d.players)) for (const [k, v] of Object.entries(d.players)) if (typeof v === 'number') players[k] = v;
  return { strings, links, prices, stock, players };
}

/** The shelf price for a label: a figure, "ask" (`null` stored), or nothing set (`undefined`). */
export function shelfPrice(shelf: Shelf, label: string): string | null | undefined {
  if (!(label in shelf.prices)) return undefined;
  return formatServicePrice(shelf.prices[label]);
}

const num = (item: CatalogItem | null, k: string): number | null => {
  const v = item?.attributes?.[k];
  return typeof v === 'number' ? v : null;
};
const text = (item: CatalogItem | null, k: string): string | null => {
  const v = item?.attributes?.[k];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

export const powerOf = (item: CatalogItem | null) => num(item, 'repulsion');
export const durabilityOf = (item: CatalogItem | null) => num(item, 'durability');
export const controlOf = (item: CatalogItem | null) => num(item, 'control');
export const bestForOf = (item: CatalogItem | null) => text(item, 'bestFor');

export interface ShelfEntry {
  label: string;
  item: CatalogItem | null;
}

/**
 * Shelf order: power descending, then durability descending, then label.
 * Strings without both ratings come after the rated ones, and labels the
 * catalog does not know come last. Stable for equal keys.
 */
export function sortShelf(entries: readonly ShelfEntry[]): ShelfEntry[] {
  const rank = (e: ShelfEntry) => (!e.item ? 2 : powerOf(e.item) === null || durabilityOf(e.item) === null ? 1 : 0);
  return entries.slice().sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const p = (powerOf(b.item) ?? -1) - (powerOf(a.item) ?? -1);
    if (p !== 0) return p;
    const d = (durabilityOf(b.item) ?? -1) - (durabilityOf(a.item) ?? -1);
    if (d !== 0) return d;
    return a.label.localeCompare(b.label);
  });
}

/** Plotted on the map: linked, with numeric power AND durability. */
export function isPlottable(e: ShelfEntry): boolean {
  return !!e.item && powerOf(e.item) !== null && durabilityOf(e.item) !== null;
}

// ── Colours ────────────────────────────────────────────────────────────────
/* eslint-disable no-restricted-syntax -- product data, not theme: a string's
   type tint and the maker's colours are the same on cream as on dark. */
//
// DATA colours, not UI tokens: a string's type and the maker's colours are
// facts about the string, the same on cream as on dark. UI colours (text,
// accent, stock) come from tokens in the components.

export type StringTypeKey = 'repulsion' | 'control' | 'durability' | 'hybrid' | 'all_round';

export function stringTypeOf(item: CatalogItem | null): StringTypeKey | null {
  const t = text(item, 'stringType')?.toLowerCase().replace('-', '_');
  return t === 'repulsion' || t === 'control' || t === 'durability' || t === 'hybrid' || t === 'all_round' ? t : null;
}

/** The type's tint; `null` for all-round and unknown, which take the neutral inner-card fill. */
const TYPE_TINT: Record<StringTypeKey, string | null> = {
  repulsion: '#fb923c',
  control: '#93c5fd',
  durability: 'var(--accent)',
  // Approved by Grant for this surface (2026-10-11): not a system colour,
  // a data colour for the two hybrid strings.
  hybrid: '#c4b5fd',
  all_round: null,
};

export function typeTint(type: StringTypeKey | null): string | null {
  return type ? TYPE_TINT[type] : null;
}

/** The header band / gauge tile fill: the tint at 26% fading to 7%. */
export function typeBand(type: StringTypeKey | null): string {
  const tint = typeTint(type);
  return tint
    ? `linear-gradient(160deg, color-mix(in srgb, ${tint} 26%, transparent), color-mix(in srgb, ${tint} 7%, transparent))`
    : 'var(--inner-card-bg)';
}

const SWATCH: Record<string, string> = {
  white: '#f1f5f9',
  yellow: '#facc15',
  'fluorescent yellow': '#d9f99d',
  orange: '#fb923c',
  red: '#f87171',
  blue: '#60a5fa',
  pink: '#f9a8d4',
  green: '#4ade80',
  purple: '#a78bfa',
  black: '#1f2937',
  gold: '#eab308',
};

const swatchOf = (name: string) => SWATCH[name.trim().toLowerCase()] ?? 'var(--text-muted)';

export interface StringColour {
  name: string;
  /** A CSS background: a flat colour, or a half-and-half gradient for a two-tone. */
  fill: string;
}

/**
 * The maker's colours from the catalog's `colors` attribute:
 * `"White; Orange; Yellow"`, with `/` marking a two-tone (`"White/Yellow"`).
 */
export function stringColours(item: CatalogItem | null): StringColour[] {
  const raw = text(item, 'colors');
  if (!raw) return [];
  return raw.split(';').map((s) => s.trim()).filter(Boolean).map((name) => {
    const parts = name.split('/').map((p) => p.trim()).filter(Boolean);
    const fill = parts.length === 2
      ? `linear-gradient(90deg, ${swatchOf(parts[0])} 50%, ${swatchOf(parts[1])} 50%)`
      : swatchOf(name);
    return { name, fill };
  });
}

/* eslint-enable no-restricted-syntax */

/** The stock band's dot colour. */
export function stockColour(band: StockBand): string {
  return band === 'in' ? 'var(--accent)' : band === 'low' ? 'var(--color-amber)' : 'var(--text-muted)';
}
