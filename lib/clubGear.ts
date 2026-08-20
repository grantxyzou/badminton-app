import type { EquipmentCategory, GearItem, PlayerGear } from './types';

/**
 * Aggregate "what the club plays" tally.
 *
 * Pure and unit-tested, because the privacy promise on this data is only as
 * good as the counting: one off-by-one in the cohort guard and a tally becomes
 * an identification.
 */

/**
 * Minimum owners before an entry is shown at all.
 *
 * Three, not one. "1 player uses X" in a twelve-person club, plus knowing who
 * turned up, is a name. Below the threshold the entry is DROPPED entirely
 * rather than shown with a count — a visible "fewer than 3" row would leak the
 * same fact one bit at a time.
 */
export const CLUB_GEAR_MIN_COHORT = 3;

export interface ClubGearEntry {
  category: EquipmentCategory;
  label: string;
  count: number;
}

/** Legacy docs predate `category` and are all rackets — the same read-tolerance
 *  pattern as `normalizeBirdUsages`. Write it explicitly from now on. */
function categoryOf(item: GearItem): EquipmentCategory {
  return (item?.category ?? 'racket') as EquipmentCategory;
}

/**
 * One vote per member per distinct label, so a member with three of the same
 * string in their bag counts once. Otherwise the tally would measure who buys
 * in bulk rather than what the club plays.
 */
export function tallyClubGear(docs: Pick<PlayerGear, 'items'>[]): ClubGearEntry[] {
  const counts = new Map<string, ClubGearEntry>();

  for (const doc of docs) {
    if (!doc || !Array.isArray(doc.items)) continue;
    const seen = new Set<string>();
    for (const item of doc.items) {
      if (!item || typeof item.label !== 'string') continue;
      const label = item.label.trim();
      if (!label) continue;
      // Retired gear is not what the club plays now.
      if (item.retiredAt) continue;
      const category = categoryOf(item);
      const key = `${category}::${label.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { category, label, count: 1 });
    }
  }

  return [...counts.values()]
    .filter((e) => e.count >= CLUB_GEAR_MIN_COHORT)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
