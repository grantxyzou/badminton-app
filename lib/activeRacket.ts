import type { PlayerGear, GearItem } from './types';

/**
 * Read-tolerant resolution of a player's current racket, mirroring
 * normalizeBirdUsages(): new docs carry an explicit pointer, legacy docs
 * don't, and both must read correctly with no migration.
 *
 * The category is read-tolerant for the same reason the pointer is. Rackets
 * predate the `category` field, so a legacy item has none; every other call
 * site already reads `(category ?? 'racket')` (gear/route.ts:164,
 * clubGear.ts:30, and the retired GearPickRail / YourKitCard). A strict `=== 'racket'` here
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

/**
 * The string on a racket (Grant, 2026-11-05: "the string should follow the
 * rackets"). A string item names the racket it is on in `racketId`; the
 * newest live string naming THIS racket is its string, with its own tension.
 *
 * Read-tolerant like the pointer above. A string written before the link
 * existed names no racket, and it was the one on whatever racket was in play,
 * so an UNLINKED string (or one naming a racket no longer in the bag) still
 * belongs to the ACTIVE racket — and to no other. The gear route pins those to
 * the racket they were on the moment the member swaps rackets
 * (`pinLooseStrings`), so a swap leaves the old string behind instead of
 * carrying it, and its tension, onto the new frame.
 *
 * With no racket in the bag at all, the newest live string is the member's.
 */
export function stringOn(gear: PlayerGear | null, racket: GearItem | null): GearItem | null {
  const on = stringsOn(gear, racket);
  return on[on.length - 1] ?? null;
}

/** Every live string on a racket, oldest first, by `stringOn`'s rule: those
 *  naming it, else (for the active racket only) those naming no racket. */
export function stringsOn(gear: PlayerGear | null, racket: GearItem | null): GearItem[] {
  const live = (gear?.items ?? []).filter((i): i is GearItem => !!i && !i.retiredAt && i.category === 'string');
  if (!racket) return live;
  const ids = new Set(rackets(gear).map((r) => r.id));
  const linked = live.filter((s) => s.racketId === racket.id);
  if (linked.length > 0) return linked;
  if (racket.id !== activeRacket(gear)?.id) return [];
  return live.filter((s) => !s.racketId || !ids.has(s.racketId));
}

/** The string the member is playing on now: the active racket's. */
export function currentString(gear: PlayerGear | null): GearItem | null {
  return stringOn(gear, activeRacket(gear));
}

/**
 * Before the active racket changes, every string that names no racket is
 * written down as being on the racket it was on — the one in play until now.
 * Returns the items unchanged (the same array) when there is nothing to pin.
 */
export function pinLooseStrings(items: GearItem[], from: GearItem | null): GearItem[] {
  if (!from) return items;
  const ids = new Set(items.filter((i) => (i.category ?? 'racket') === 'racket').map((i) => i.id));
  if (!ids.has(from.id)) return items;
  let changed = false;
  const out = items.map((i) => {
    if (!i || i.category !== 'string' || i.retiredAt) return i;
    if (i.racketId && ids.has(i.racketId)) return i;
    changed = true;
    return { ...i, racketId: from.id };
  });
  return changed ? out : items;
}
