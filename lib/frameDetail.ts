import { activeRacket } from './activeRacket';
import { isOffered } from './catalogOffer';
import { axesOf, buildTarget, compareFit, isScorable, scoreFit, type FitInput } from './racketFit';
import { MAX_LB, MIN_LB } from './tension';
import type { CatalogItem, GearItem, PlayerGear, StringLogEntry } from './types';

/**
 * The frame page's rules (design "Equipment redesign", Turn 3, 3d). Pure.
 *
 * The page is a reference you can check courtside, and the handoff's standing
 * rule applies to every line: a fact the app does not actually hold is not
 * shown. No release year (the catalog has none), no member-reported price (no
 * member reports one), no "what the club strings it with" for a frame nobody
 * logs against — those cells and rows are simply absent.
 */

/** USD → CAD for a TYPICAL range. A rough constant, captioned as such on the
 *  page; it is not a live rate and must never read as one. */
export const USD_TO_CAD = 1.38;

export type SpecKey = 'weight' | 'balance' | 'shaft' | 'rated' | 'grip' | 'price';

export interface SpecCell {
  key: SpecKey;
  /** Formatted, language-free text. `rated` leaves it empty: the page words
   *  its bounds ("up to 28 lb" is a phrase, not a figure). */
  value: string;
  /** `rated` only: the bounds the maker printed, either side possibly absent. */
  bounds?: [number | null, number | null];
}

const str = (row: CatalogItem, key: string): string | null => {
  const v = row.attributes?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};
const num = (row: CatalogItem, key: string): number | null => {
  const v = row.attributes?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** "4U/5U" reads as "4U · 5U" in a cell. */
const slashes = (s: string) => s.split('/').map((p) => p.trim()).filter(Boolean).join(' · ');

/** A typical retail range in CAD, rounded to $5, or null without both bounds. */
export function cadRange(row: CatalogItem): [number, number] | null {
  const lo = num(row, 'priceMinUSD');
  const hi = num(row, 'priceMaxUSD');
  if (lo === null || hi === null || hi < lo) return null;
  const five = (usd: number) => Math.round((usd * USD_TO_CAD) / 5) * 5;
  return [five(lo), five(hi)];
}

/** The spec grid, in the design's order, with any cell the row cannot fill left out. */
export function specCells(row: CatalogItem): SpecCell[] {
  const cells: SpecCell[] = [];
  const weight = str(row, 'weight');
  if (weight) {
    const lo = num(row, 'weightMinG');
    const hi = num(row, 'weightMaxG');
    const grams = lo !== null && hi !== null ? (lo === hi ? `${lo} g` : `${lo}–${hi} g`) : null;
    cells.push({ key: 'weight', value: [slashes(weight), grams].filter(Boolean).join(' · ') });
  }
  const balance = str(row, 'balance');
  if (balance) cells.push({ key: 'balance', value: balance });
  const flex = str(row, 'flex');
  if (flex) cells.push({ key: 'shaft', value: flex });
  // Only what the maker printed. `ratedRange` fills a missing side from the
  // app's own scale — right for a field's clamp, wrong for a spec sheet.
  const tLo = num(row, 'tensionMinLbs');
  const tHi = num(row, 'tensionMaxLbs');
  if (tLo !== null || tHi !== null) cells.push({ key: 'rated', value: '', bounds: [tLo, tHi] });
  const grip = str(row, 'gripSize');
  if (grip) cells.push({ key: 'grip', value: slashes(grip) });
  const price = cadRange(row);
  if (price) cells.push({ key: 'price', value: `$${price[0]}–$${price[1]}` });
  return cells;
}

/**
 * "Close to this one": the catalog ranked by the fit engine's own distance to
 * this frame's spec, nearest first. The same axes and weights the racket pick
 * uses, so "close" here means what it means there — balance weighs most, then
 * shaft, then price tier, with grams as the tie-break.
 */
export function closeToFrame(row: CatalogItem, catalog: CatalogItem[], n = 3): CatalogItem[] {
  const anchorAxes = axesOf(row);
  if (!anchorAxes) return [];
  const input: FitInput = {
    anchor: row, ownedIds: new Set([row.id]), ownedLabels: new Set(), format: 'both', level: null, hasRatings: false,
  };
  const target = buildTarget(input, anchorAxes);
  const scored = [];
  for (const item of catalog) {
    if (item.category !== 'racket' || item.id === row.id || !isScorable(item) || !isOffered(item)) continue;
    const axes = axesOf(item);
    if (axes) scored.push(scoreFit(item, axes, target, input, anchorAxes));
  }
  return scored.sort(compareFit).slice(0, n).map((s) => s.item);
}

export interface FrameHistory {
  /** The bag's racket of this model, in play first. Null when not owned. */
  owned: GearItem | null;
  /** Whether that racket is the one in play. */
  inPlay: boolean;
  /** Restrings logged against this model, newest first. */
  restrings: StringLogEntry[];
  /** The last four recorded tensions, oldest first ("24 → 25 → 26 → 26"). */
  lastFour: number[];
  /** The newest live string, only while this model is in play. */
  currentString: GearItem | null;
}

export function frameHistory(gear: PlayerGear | null, frameId: string): FrameHistory {
  const rackets = (gear?.items ?? []).filter((i) => i && !i.retiredAt && i.category === 'racket' && i.catalogId === frameId);
  const active = activeRacket(gear);
  const inPlay = !!active && active.catalogId === frameId;
  const owned = inPlay ? active : rackets[0] ?? null;
  const ownedIds = new Set(rackets.map((r) => r.id));
  // Keyed by the racket's MODEL, and by the bag item as a fallback for an
  // entry written before a typed racket was matched to its catalog row.
  const restrings = (gear?.stringLog ?? [])
    .filter((e) => e && (e.racketCatalogId === frameId || (!!e.racketItemId && ownedIds.has(e.racketItemId))))
    .slice()
    .reverse();
  const lastFour = restrings
    .map((e) => e.tensionLbs)
    .filter((v): v is number => typeof v === 'number')
    .slice(0, 4)
    .reverse();
  let currentString: GearItem | null = null;
  if (inPlay) for (const i of gear?.items ?? []) if (i && !i.retiredAt && i.category === 'string') currentString = i;
  return { owned, inPlay, restrings, lastFour, currentString };
}

/** Where a tension sits on the chart's fixed 20–30 lb scale, 0–1, clamped. */
export function bandPosition(lbs: number): number {
  return Math.max(0, Math.min(1, (lbs - MIN_LB) / (MAX_LB - MIN_LB)));
}
