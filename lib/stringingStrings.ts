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
import { getContainer } from './cosmos';
import { ensureClubSettings } from './stringingShop';

export const STRINGS_DOC_ID = 'stringing-strings';
export const MAX_OFFERED = 24;
export const MAX_LABEL_LEN = 60;

export interface OfferedStringsDoc {
  id: string;
  strings: string[];
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * What the club stocks, or `null` if we could not find out.
 *
 * Null is UNKNOWN and is not the same as `[]`. The form treats them
 * differently: an empty list means "nothing declared, use the custom path",
 * while unknown means "we could not ask" and must not be presented as a
 * confident empty stock list.
 */
export async function readOfferedStrings(): Promise<string[] | null> {
  try {
    await ensureClubSettings();
    const { resource } = await getContainer('clubSettings')
      .item(STRINGS_DOC_ID, STRINGS_DOC_ID)
      .read<OfferedStringsDoc>();
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
