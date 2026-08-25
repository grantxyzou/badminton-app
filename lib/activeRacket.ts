import type { PlayerGear, GearItem } from './types';

/**
 * Read-tolerant resolution of a player's current racket, mirroring
 * normalizeBirdUsages(): new docs carry an explicit pointer, legacy docs
 * don't, and both must read correctly with no migration.
 *
 * The category is read-tolerant for the same reason the pointer is. Rackets
 * predate the `category` field, so a legacy item has none; every other call
 * site already reads `(category ?? 'racket')` (gear/route.ts:164,
 * clubGear.ts:30, GearPickRail, YourKitCard). A strict `=== 'racket'` here
 * made a legacy item unactivatable in a way that showed nothing: the item
 * listed fine (those call sites are tolerant) but this returned null, so the
 * row offered "Use this one", and the PATCH guard — which calls this same
 * helper — 404'd. `onActivate` discards the result, so the button did
 * nothing, forever, silently.
 */
export function rackets(gear: PlayerGear | null): GearItem[] {
  return (gear?.items ?? []).filter((i) => (i.category ?? 'racket') === 'racket');
}

export function activeRacket(gear: PlayerGear | null): GearItem | null {
  const list = rackets(gear);
  if (list.length === 0) return null;
  const pointed = gear?.activeRacketId
    ? list.find((i) => i.id === gear.activeRacketId)
    : undefined;
  return pointed ?? list[0];
}
