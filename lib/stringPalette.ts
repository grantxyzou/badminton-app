/**
 * The colours a club can say it has a string in — the fixed palette the
 * bench's colour picker offers and the Stringing tab draws.
 *
 * Ids, never hex, are what is stored on the shelf (`OfferedStringsDoc.colours`),
 * so a redrawn swatch changes every club's shelf at once and a stored value is
 * always one the app can draw. The ids cover every colour name the string
 * catalog uses (its `colors` attribute), plus the few a reel commonly comes in
 * that the catalog has not needed yet. The swatches themselves are
 * `paletteFill` in `lib/stringShelf.ts`, beside the catalog's.
 *
 * Import-free, so both the route and the client can read it.
 */
export const STRING_PALETTE = [
  'white', 'yellow', 'fluo_yellow', 'gold', 'orange', 'red', 'pink',
  'purple', 'blue', 'navy', 'turquoise', 'green', 'grey', 'black',
] as const;

export type StringColourId = (typeof STRING_PALETTE)[number];

const IDS = new Set<string>(STRING_PALETTE);

export function isStringColourId(v: unknown): v is StringColourId {
  return typeof v === 'string' && IDS.has(v);
}

/** More than any reel comes in; a cap so the shelf doc stays small. */
export const MAX_COLOURS_PER_STRING = 8;

/** A submitted colour list cleaned: palette ids only, in palette order, no repeats, capped. */
export function normaliseColourList(value: unknown): StringColourId[] {
  if (!Array.isArray(value)) return [];
  const wanted = new Set(value.filter(isStringColourId));
  return STRING_PALETTE.filter((id) => wanted.has(id)).slice(0, MAX_COLOURS_PER_STRING);
}
