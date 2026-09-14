import type { CatalogItem } from './types';

/**
 * Whether a catalog row may be OFFERED to someone new: picked by the
 * recommender, or listed in an "Add a racket" sheet.
 *
 * `attributes.unlisted` holds the reason a row is withdrawn (e.g.
 * `'not_a_model'`). The row itself stays, because a member's bag may point at
 * its id and must keep resolving to its name and specs, and because catalog
 * seeding never deletes a Cosmos row. Kept apart from `isScorable`, which
 * answers a different question ("can this row be scored at all?") and is also
 * how a member's OWN racket is read.
 */
export function isOffered(item: CatalogItem): boolean {
  return item.attributes?.unlisted === undefined;
}
