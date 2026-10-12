/**
 * The strings the club actually offers.
 *
 * The stringer types these in once on the bench; the request form turns them
 * into a dropdown. That direction matters: a free-text string field on the
 * player side produces "bg80", "BG-80", "Bg 80 white" and "yonex 80" for one
 * spool, and the person who has to reconcile that is the stringer.
 *
 * Lives in `clubSettings` alongside the shop sign — same reasoning as there:
 * it is club-wide rather than per-admin, and a PLAYER has to be able to read
 * it, which rules out any admin's own member document.
 *
 * An empty list is a real answer, not a broken one. It means "I have not said
 * what I stock yet", and the form degrades to the custom path rather than
 * offering an empty dropdown.
 */
import { groupDocId, groupScope } from './groupScope';
import { ensureClubSettings } from './stringingShop';

export const STRINGS_DOC_ID = 'stringing-strings';
/** One list per club: bare for BPM, `'<groupId>:stringing-strings'` otherwise. */
export function stringsDocId(groupId: string): string {
  return groupDocId(groupId, STRINGS_DOC_ID);
}
export { MAX_OFFERED, MAX_LABEL_LEN } from './stringingLimits';
import { MAX_OFFERED, MAX_LABEL_LEN } from './stringingLimits';
import { MAX_PRICE_CENTS } from './stringingRateCard';

export interface OfferedStringsDoc {
  id: string;
  strings: string[];
  /**
   * Offered label → catalog id (`string-…`), for the labels the admin matched
   * to a catalog row (docs/plans/string-inventory.md). ADDITIVE: every reader
   * of `strings` is untouched, and a label with no link is a string the
   * catalog does not know — still offered, just not explained. Keys are
   * exactly the spelling in `strings`.
   */
  links?: Record<string, string>;
  /**
   * Offered label → restring price in cents for a restring with that string;
   * `null` = "Ask" (docs/design/strings-shelf-spec.md). ADDITIVE, the same
   * pattern as `links`: a label with no entry has no price set and shows
   * none. One all-in figure per string, set by the stringer — not an
   * estimate, so it is never shown with a tilde.
   */
  prices?: Record<string, number | null>;
  /**
   * Old spelling → offered label (docs/plans/bench-redesign.md): a purchase
   * or a job recorded under the old spelling counts as the offered string in
   * the stock arithmetic. ADDITIVE, and nothing it points at is rewritten —
   * rewriting purchase labels instead would strand the jobs strung under the
   * old spelling. Admin-only: the public read does not return it.
   */
  aliases?: Record<string, string>;
  updatedAt: string;
  updatedBy: string | null;
}

export interface OfferedStringsRead {
  strings: string[];
  links: Record<string, string>;
  prices: Record<string, number | null>;
  aliases: Record<string, string>;
}

/** More than any shelf has had typos for; a cap so the doc stays small. */
export const MAX_ALIASES = 50;

/** The offered strings with their catalog links and prices; `null` when the read threw. */
export async function readOfferedStringsWithLinks(groupId: string): Promise<OfferedStringsRead | null> {
  try {
    await ensureClubSettings();
    const resource = await groupScope(groupId).read<OfferedStringsDoc>('clubSettings', stringsDocId(groupId));
    const strings = Array.isArray(resource?.strings) ? resource!.strings : [];
    const raw = resource?.links && typeof resource.links === 'object' ? resource.links : {};
    const known = new Set(strings);
    const links: Record<string, string> = {};
    for (const [label, id] of Object.entries(raw)) if (known.has(label) && typeof id === 'string') links[label] = id;
    return { strings, links, prices: normalisePrices(resource?.prices, strings), aliases: normaliseAliases(resource?.aliases, strings) };
  } catch (err) {
    console.error('readOfferedStringsWithLinks failed:', err);
    return null;
  }
}

/**
 * Clean a submitted link map against the (already normalised) list and the
 * catalog's string ids. A link for a label not in the list, or to an id the
 * catalog does not have, is DROPPED rather than refused: the list is what the
 * admin is saving, the link is a detail on it.
 */
export function normaliseLinks(value: unknown, strings: readonly string[], validIds: ReadonlySet<string>): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const known = new Set(strings);
  const out: Record<string, string> = {};
  for (const [label, id] of Object.entries(value as Record<string, unknown>)) {
    if (!known.has(label) || typeof id !== 'string' || !validIds.has(id)) continue;
    out[label] = id;
  }
  return out;
}

/**
 * Clean a submitted price map against the (already normalised) list. Like
 * `normaliseLinks`, anything wrong is DROPPED rather than refused: a label not
 * in the list, or a value that is not `null` or a whole number of cents from
 * 0 to `MAX_PRICE_CENTS`. `null` survives — it is "Ask", a real answer.
 */
export function normalisePrices(value: unknown, strings: readonly string[]): Record<string, number | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const known = new Set(strings);
  const out: Record<string, number | null> = {};
  for (const [label, cents] of Object.entries(value as Record<string, unknown>)) {
    if (!known.has(label)) continue;
    if (cents === null) out[label] = null;
    else if (typeof cents === 'number' && Number.isInteger(cents) && cents >= 0 && cents <= MAX_PRICE_CENTS) out[label] = cents;
  }
  return out;
}

/**
 * Clean a submitted alias map against the (already normalised) list. DROPPED
 * rather than refused, like links and prices: a target that is not offered, a
 * blank or over-long old spelling, and an old spelling that is ITSELF offered
 * (case-insensitively) — an alias from a real shelf label would fold one
 * string's stock into another's.
 */
export function normaliseAliases(value: unknown, strings: readonly string[]): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const known = new Set(strings);
  const offeredKeys = new Set(strings.map((x) => x.trim().toLowerCase()));
  const out: Record<string, string> = {};
  for (const [rawFrom, to] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_ALIASES) break;
    const from = rawFrom.trim();
    if (!from || from.length > MAX_LABEL_LEN || typeof to !== 'string' || !known.has(to)) continue;
    if (offeredKeys.has(from.toLowerCase())) continue;
    out[from] = to;
  }
  return out;
}

/**
 * What the club stocks, or `null` if we could not find out.
 *
 * Null is UNKNOWN and is not the same as `[]`. The form treats them
 * differently: an empty list means "nothing declared, use the custom path",
 * while unknown means "we could not ask" and must not be presented as a
 * confident empty stock list.
 */
export async function readOfferedStrings(groupId: string): Promise<string[] | null> {
  try {
    await ensureClubSettings();
    const resource = await groupScope(groupId).read<OfferedStringsDoc>('clubSettings', stringsDocId(groupId));
    if (!resource) return [];
    return Array.isArray(resource.strings) ? resource.strings : [];
  } catch (err) {
    console.error('readOfferedStrings failed:', err);
    return null;
  }
}

/**
 * Clean a submitted list.
 *
 * Trims, drops blanks, removes case-insensitive duplicates while KEEPING the
 * first spelling the stringer used — their capitalisation is the one that ends
 * up on the shelf label, so it is the one worth preserving. Returns null if the
 * input is not a list of strings at all.
 */
export function normaliseOfferedStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_OFFERED) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return null;
    const t = raw.trim();
    if (!t) continue;
    if (t.length > MAX_LABEL_LEN) return null;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
