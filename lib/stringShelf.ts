/**
 * The strings shelf, client half (docs/design/strings-shelf-spec.md): reading
 * the `GET /api/stringing/strings` payload, the order strings are shown in,
 * and the fixed DATA colours — a string's type tint and its maker's colours.
 *
 * Client-safe: imports types and `stringingRateCard` (import-free) only.
 * `__tests__/client-server-import-canary.test.ts` holds the line.
 */
import type { CatalogItem } from './types';
import type { ColourStock, StockBand } from './stringStockMath';
import { formatServicePrice } from './stringingRateCard';
import {
  colourIdOf, comboParts, hexOfCustom, isComboColourId, isCustomColourId, isStringColourId, normaliseColourList,
  normaliseCustomColours, reelColourEnglish,
  type ComboColourId, type CustomColour, type ReelColourId, type StringColourId,
} from './stringPalette';

export type { ColourStock, StockBand };

export interface Shelf {
  strings: string[];
  links: Record<string, string>;
  /** Label → cents; `null` = "Ask"; a missing label has no price set. */
  prices: Record<string, number | null>;
  /** `null` = the stock read failed; a missing label = unknown. */
  stock: Record<string, StockBand> | null;
  players: Record<string, number>;
  /** Label → the colours the club has it in (reel colour ids); a missing label has none said. */
  colours: Record<string, ReelColourId[]>;
  /** Label → which colours are on the shelf, from colour-tagged purchases;
   *  a missing label has none tagged (docs/plans/string-stock-by-colour.md). */
  colourStock: Record<string, ColourStock>;
  /** Label → the stringer's note for players; a missing label has none. */
  notes: Record<string, string>;
  /** The club's own colours (`custom:<rrggbb>` with a name); `[]` for none. */
  customColours: CustomColour[];
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
  const customColours = normaliseCustomColours(d.customColours);
  const customIds = new Set(customColours.map((c) => c.id));
  const colours: Record<string, ReelColourId[]> = {};
  if (isObj(d.colours)) {
    for (const [k, v] of Object.entries(d.colours)) {
      const list = normaliseColourList(v, customIds);
      if (list.length > 0) colours[k] = list;
    }
  }
  const colourStock: Record<string, ColourStock> = {};
  if (isObj(d.colourStock)) {
    for (const [k, v] of Object.entries(d.colourStock)) {
      if (!isObj(v)) continue;
      colourStock[k] = { inStock: normaliseColourList(v.inStock, customIds), mixed: v.mixed === true };
    }
  }
  const notes: Record<string, string> = {};
  if (isObj(d.notes)) for (const [k, v] of Object.entries(d.notes)) if (typeof v === 'string' && v.trim()) notes[k] = v.trim();
  return { strings, links, prices, stock, players, colours, colourStock, notes, customColours };
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
/** The maker's hitting sound, 1–10 (`hittingSound`). */
export const soundOf = (item: CatalogItem | null) => num(item, 'hittingSound');
/** The maker's shock absorption, 1–10 (`shockAbsorption`, re-sourced 2026-11-12;
 *  Yonex and Li-Ning publish it, Victor does not). */
export const shockOf = (item: CatalogItem | null) => num(item, 'shockAbsorption');
/** Soft to hard, 1–5 (`feelScale`; higher is harder). */
export const feelOf = (item: CatalogItem | null) => num(item, 'feelScale');

/**
 * What runs up the side of the map (docs/plans/string-inventory.md,
 * Decisions, 2026-10-16). Durability always runs along the bottom; power is
 * its mirror image (r = −0.78 across the catalog), so the map read as one
 * diagonal until the member could swap power for another rating.
 *
 * The four are the maker's own ratings since 2026-11-12 (Grant: "For yonex:
 * repulsion, durability, control, sound, shock absorption … lining and Victor
 * can map to that too"): power is the maker's REPULSION (the catalog key is
 * `repulsion`; the id stays `power` so a stored pick and the trait colours
 * keep working), then control, hitting sound and shock absorption. Feel left
 * the switch: it is a soft-to-hard word, not one of the maker's five, and the
 * string's headline already says it. A stored `feel` falls back to power.
 */
export const MAP_AXES = ['power', 'control', 'sound', 'shock'] as const;
export type MapAxis = (typeof MAP_AXES)[number];
/** The top of each axis's scale, for "out of" in the copy. */
export const AXIS_MAX: Record<MapAxis, number> = { power: 10, control: 10, sound: 10, shock: 10 };

export function axisValueOf(axis: MapAxis, item: CatalogItem | null): number | null {
  return axis === 'power' ? powerOf(item) : axis === 'control' ? controlOf(item) : axis === 'sound' ? soundOf(item) : shockOf(item);
}
export const bestForOf = (item: CatalogItem | null) => text(item, 'bestFor');

/**
 * The catalog's five feels as the three words a string's headline uses
 * ("Power · Hard feel"): medium-soft reads soft, medium-hard reads hard.
 * Keys `heroFeel_<word>` in `home.stringing.offer`.
 */
export function feelWordOf(item: CatalogItem | null): 'soft' | 'medium' | 'hard' | null {
  const raw = text(item, 'feel')?.toLowerCase();
  const feel = raw === 'medium-soft' ? 'soft' : raw === 'medium-hard' ? 'hard' : raw;
  return feel === 'soft' || feel === 'medium' || feel === 'hard' ? feel : null;
}

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

/** The maker's five rated traits, as a list row and a meter name them. */
export type Trait = 'power' | 'control' | 'durability' | 'sound' | 'shock';
/** The five in the order the maker prints them (repulsion first). */
export const TRAITS: readonly Trait[] = ['power', 'durability', 'control', 'sound', 'shock'];

/** A trait's 1–10 rating, or null when the maker gives none. */
export function traitValueOf(trait: Trait, item: CatalogItem | null): number | null {
  return trait === 'durability' ? durabilityOf(item) : axisValueOf(trait, item);
}

/**
 * A trait's colour (Grant, 2026-11-12: "use colour code to map to control,
 * power, durability, and repulsion"): the tint of the string TYPE tuned for
 * it, so a trait and a type never disagree. "Repulsion" is the maker's word
 * for power — the catalog's power score IS `repulsion` (`powerOf`) — so the
 * two share one colour.
 */
const TRAIT_TYPE: Partial<Record<Trait, StringTypeKey>> = { power: 'repulsion', control: 'control', durability: 'durability' };
/** Sound and shock are ratings, never a string's type, so they have tints
 *  of their own (the canvas, 2026-11-12: pink and teal). */
const TRAIT_OWN: Partial<Record<Trait, string>> = { sound: '#f472b6', shock: '#2dd4bf' };

export function traitTint(trait: Trait): string {
  const type = TRAIT_TYPE[trait];
  return type ? (TYPE_TINT[type] as string) : (TRAIT_OWN[trait] as string);
}

/**
 * A map dot's fill: its type's tint, or neutral ink for all-round and
 * unknown — not the accent, which is durability's green and would say a type
 * the string is not.
 */
export function typeDotFill(type: StringTypeKey | null): string {
  return typeTint(type) ?? 'var(--text-muted)';
}

/** Ink for a count drawn ON a type dot: the tints are light on both themes,
 *  so a dark shade of the tint itself; the neutral dot keeps the page ink. */
export function typeDotInk(type: StringTypeKey | null): string {
  const tint = typeTint(type);
  return tint ? `color-mix(in srgb, ${tint} 25%, black)` : 'var(--page-bg)';
}

/** The order the map's legend lists the types in: power first, as everywhere. */
export const TYPE_ORDER: readonly StringTypeKey[] = ['repulsion', 'control', 'durability', 'hybrid', 'all_round'];

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

/** The club's palette (`lib/stringPalette.ts`), drawn: the catalog's swatches, plus the three it lacks. */
const PALETTE_FILL: Record<StringColourId, string> = {
  white: SWATCH.white,
  yellow: SWATCH.yellow,
  fluo_yellow: SWATCH['fluorescent yellow'],
  gold: SWATCH.gold,
  orange: SWATCH.orange,
  red: SWATCH.red,
  pink: SWATCH.pink,
  purple: SWATCH.purple,
  blue: SWATCH.blue,
  navy: '#1e3a8a',
  turquoise: '#2dd4bf',
  green: SWATCH.green,
  grey: '#9ca3af',
  black: SWATCH.black,
};

export function paletteFill(id: StringColourId): string {
  return PALETTE_FILL[id];
}

/** A colour nobody can draw (a malformed id): the muted ink, never a guess. */
const UNKNOWN_FILL = 'var(--text-muted)';

/**
 * Any reel colour, drawn as a CSS background: a palette swatch, a club
 * colour from the hex its id carries, or a set split down the middle —
 * MAINS on the left, crosses on the right.
 */
export function reelColourFill(id: ReelColourId | string): string {
  if (isStringColourId(id)) return PALETTE_FILL[id];
  if (isCustomColourId(id)) return hexOfCustom(id);
  const parts = comboParts(id);
  if (!parts) return UNKNOWN_FILL;
  return `linear-gradient(90deg, ${reelColourFill(parts.mains)} 50%, ${reelColourFill(parts.crosses)} 50%)`;
}

/**
 * Ink for a letter drawn ON a single colour's swatch (a set's "M" and "C"):
 * near-black on a light colour, white on a dark one, by relative luminance.
 */
export function swatchInk(id: StringColourId | string): string {
  const fill = isStringColourId(id) ? PALETTE_FILL[id] : isCustomColourId(id) ? hexOfCustom(id) : '';
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fill);
  if (!m) return 'var(--text-primary)';
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => {
    const c = parseInt(x, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? '#111827' : '#ffffff';
}

/** The "Custom colour" step's quick picks: one tap to a colour no palette has. */
export const CUSTOM_PRESETS: readonly string[] = [
  '#14b8a6', '#84cc16', '#f43f5e', '#c026d3', '#0ea5e9', '#a16207', '#64748b', '#fde68a',
];

/** The hue strip behind the "Custom colour" step's slider, red round to red. */
export const HUE_STRIP = 'linear-gradient(90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)';

/** A hue (0–359) as a reel-friendly `#rrggbb`: saturated, mid-light. */
export function hexOfHue(hue: number): string {
  const h = ((Math.round(hue) % 360) + 360) % 360;
  const s = 0.75;
  const l = 0.55;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** A `#rrggbb`'s hue, 0–359 (0 for a grey). */
export function hueOfHex(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}

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
    // A colour the reel vocabulary names is drawn as the reel picker draws it
    // ("Yellow/Grey" is yellow mains, grey crosses); anything else as before.
    const id = colourIdOf(name);
    if (id) return { name, fill: reelColourFill(id) };
    const parts = name.split('/').map((p) => p.trim()).filter(Boolean);
    const fill = parts.length === 2
      ? `linear-gradient(90deg, ${swatchOf(parts[0])} 50%, ${swatchOf(parts[1])} 50%)`
      : swatchOf(name);
    return { name, fill };
  });
}

/* eslint-enable no-restricted-syntax */

/**
 * The maker's colours for a linked string as reel colour ids, in the
 * catalog's order: "Red/White" is the set with red mains
 * (`combo:red+white`). A colour the palette does not name is left out.
 */
export function makerColourIds(item: CatalogItem | null): ReelColourId[] {
  const out: ReelColourId[] = [];
  for (const c of stringColours(item)) {
    const id = colourIdOf(c.name);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The two-colour sets a club has on any string's reel, in shelf order. */
export function clubCombos(colours: Readonly<Record<string, readonly ReelColourId[]>>): ComboColourId[] {
  const out: ComboColourId[] = [];
  for (const list of Object.values(colours)) for (const id of list) if (isComboColourId(id) && !out.includes(id)) out.push(id);
  return out;
}

/** The stock band's dot colour. */
export function stockColour(band: StockBand): string {
  return band === 'in' ? 'var(--accent)' : band === 'low' ? 'var(--color-amber)' : 'var(--text-muted)';
}

/** A colour the request sheet can offer. */
export interface RequestColour {
  /** The reel colour id, when one names it (a catalog colour the palette lacks has none). */
  id: ReelColourId | null;
  /** What the job stores as `stringColor`: the English name ("Red / White" for a set, a club colour as typed), or the catalog's. */
  name: string;
  fill: string;
}

/**
 * The colours a member may pick for a string on the request sheet
 * (docs/plans/string-stock-by-colour.md, Grant 2026-11-11: "this need to match
 * and be dynamic to the strings inventory and string type").
 *
 * The BASE list is the stringer's word — the reel colours set on the bench —
 * and the maker's catalog list only when he has said none. When any purchase
 * of the string carries a colour, only the tagged colours with sets left are
 * offered, plus the base list while untagged ("Mixed / not sure") stock is
 * left, since that reel could be any of them. Out of stock is HIDDEN, never
 * greyed. An empty answer asks nothing.
 */
export function requestColours(shelf: Shelf | null, label: string, item: CatalogItem | null): RequestColour[] {
  const customs = shelf?.customColours ?? [];
  // A club colour with no name to send is left out: a job saying nothing is better than one saying an id.
  const fromId = (id: ReelColourId): RequestColour | null => {
    const name = reelColourEnglish(id, customs);
    return name ? { id, name, fill: reelColourFill(id) } : null;
  };
  const known = (c: RequestColour | null): c is RequestColour => c !== null;
  const reel = shelf?.colours[label] ?? [];
  const base: RequestColour[] = reel.length > 0
    ? reel.map(fromId).filter(known)
    : stringColours(item).map((c) => {
        const id = colourIdOf(c.name);
        return (id ? fromId(id) : null) ?? { id: null, name: c.name, fill: c.fill };
      });
  const stocked = shelf?.colourStock[label];
  if (!stocked) return base;
  const out = stocked.inStock.map(fromId).filter(known);
  if (stocked.mixed) for (const c of base) if (!out.some((o) => o.name === c.name)) out.push(c);
  return out;
}
