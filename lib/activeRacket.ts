import type { PlayerGear, GearItem } from './types';

/**
 * Read-tolerant resolution of a player's current racket, mirroring
 * normalizeBirdUsages(): new docs carry an explicit pointer, legacy docs
 * don't, and both must read correctly with no migration.
 */
export function rackets(gear: PlayerGear | null): GearItem[] {
  return (gear?.items ?? []).filter((i) => i.category === 'racket');
}

export function activeRacket(gear: PlayerGear | null): GearItem | null {
  const list = rackets(gear);
  if (list.length === 0) return null;
  const pointed = gear?.activeRacketId
    ? list.find((i) => i.id === gear.activeRacketId)
    : undefined;
  return pointed ?? list[0];
}
