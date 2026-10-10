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
  updatedAt: string;
  updatedBy: string | null;
}

/** The offered strings with their catalog links; `null` when the read threw. */
export async function readOfferedStringsWithLinks(groupId: string): Promise<{ strings: string[]; links: Record<string, string> } | null> {
  try {
    await ensureClubSettings();
    const resource = await groupScope(groupId).read<OfferedStringsDoc>('clubSettings', stringsDocId(groupId));
    const strings = Array.isArray(resource?.strings) ? resource!.strings : [];
    const raw = resource?.links && typeof resource.links === 'object' ? resource.links : {};
    const known = new Set(strings);
    const links: Record<string, string> = {};
    for (const [label, id] of Object.entries(raw)) if (known.has(label) && typeof id === 'string') links[label] = id;
    return { strings, links };
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
