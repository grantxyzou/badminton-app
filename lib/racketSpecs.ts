import type { CatalogItem } from './types';

/**
 * Pure display helpers for racket specs. Lives outside the components so the
 * hero card, the recommendation card and the picker rows cannot drift in how
 * they render the same item, and so every string is testable without a DOM.
 *
 * Everything degrades by omission. The 15 pre-import rows have no
 * `weightGrams`, `series` or `notes`, so any helper may return null and the
 * caller renders nothing rather than a placeholder dash.
 */

function attr(item: CatalogItem, key: string): string | null {
  const value = item.attributes?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The source data's play-style field is free text with 20 distinct values
 * ("Power (beginner step-up)", "All-round / Speed"). Collapse to the leading
 * term for display. Display only — nothing branches on this.
 */
export function playStyleLabel(item: CatalogItem): string | null {
  const raw = attr(item, 'playStyle');
  if (!raw) return null;
  return raw.split('/')[0].split('(')[0].trim() || null;
}

/** "4U" + "83-88" -> "4U (83–88g)". Grams make the class self-explanatory. */
export function weightLabel(item: CatalogItem): string | null {
  const weight = attr(item, 'weight');
  if (!weight) return null;
  const grams = attr(item, 'weightGrams');
  if (!grams) return weight;
  return `${weight} (${grams.replace('-', '–')}g)`;
}

/** Two tiers, most-human first: plain language, then the spec sheet. */
export function specTiers(item: CatalogItem): { plain: string | null; specs: string | null } {
  const plain = [playStyleLabel(item), attr(item, 'balance')].filter(Boolean).join(' · ');
  const specs = [weightLabel(item), attr(item, 'flex')].filter(Boolean).join(' · ');
  return { plain: plain || null, specs: specs || null };
}

// Ordered light -> heavy. Combined classes ("4U/5U") take their first term.
const WEIGHT_ORDER = ['6U', '5U', '4U', '3U', '2U'];
const FLEX_ORDER = ['Flexible', 'Medium', 'Medium-Stiff', 'Stiff', 'Extra Stiff'];

function rank(order: string[], raw: string | null): number | null {
  if (!raw) return null;
  const head = raw.split('/')[0].trim().toLowerCase();
  const index = order.findIndex((o) => o.toLowerCase() === head);
  return index === -1 ? null : index;
}

/**
 * Classify a balance string to one of three states: 'light', 'heavy', 'even', or unknown.
 * Strips leading "slightly " qualifier before matching on full tokens.
 */
function classifyBalance(raw: string | null): 'light' | 'heavy' | 'even' | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/^slightly\s+/, '');
  if (normalized.includes('head-light')) return 'light';
  if (normalized.includes('head-heavy')) return 'heavy';
  if (normalized === 'even') return 'even';
  return null;
}

/**
 * How a recommended racket differs from the one the player already has.
 * Returns an i18n key suffix, or null when there is nothing useful to say.
 *
 * First difference wins, in weight -> balance -> flex order: weight is the
 * most felt on court, flex the least. One phrase only — a card that lists
 * three deltas is a spec diff, not a nudge.
 */
export function compareRackets(mine: CatalogItem | null, theirs: CatalogItem): string | null {
  if (!mine) return null;

  const mineWeight = rank(WEIGHT_ORDER, attr(mine, 'weight'));
  const theirsWeight = rank(WEIGHT_ORDER, attr(theirs, 'weight'));
  if (mineWeight !== null && theirsWeight !== null && mineWeight !== theirsWeight) {
    return theirsWeight < mineWeight ? 'lighter' : 'heavier';
  }

  const mineBalance = classifyBalance(attr(mine, 'balance'));
  const theirsBalance = classifyBalance(attr(theirs, 'balance'));
  if (mineBalance && theirsBalance && mineBalance !== 'even' && theirsBalance !== 'even' && mineBalance !== theirsBalance) {
    return theirsBalance === 'light' ? 'moreHeadLight' : 'moreHeadHeavy';
  }

  const mineFlex = rank(FLEX_ORDER, attr(mine, 'flex'));
  const theirsFlex = rank(FLEX_ORDER, attr(theirs, 'flex'));
  if (mineFlex !== null && theirsFlex !== null && mineFlex !== theirsFlex) {
    return theirsFlex < mineFlex ? 'moreFlexible' : 'stiffer';
  }

  return null;
}
