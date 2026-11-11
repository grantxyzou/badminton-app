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

/**
 * The palette in English — what a job's `stringColor` says when the member
 * picked a palette colour (docs/plans/string-stock-by-colour.md). The catalog's
 * `colors` attribute uses these same names, so a job from either source maps
 * back to an id. Display goes through `home.stringing.offer.colourName.*`;
 * this is the STORED word, which the bench (English) reads.
 */
export const PALETTE_EN: Record<StringColourId, string> = {
  white: 'White',
  yellow: 'Yellow',
  fluo_yellow: 'Fluorescent yellow',
  gold: 'Gold',
  orange: 'Orange',
  red: 'Red',
  pink: 'Pink',
  purple: 'Purple',
  blue: 'Blue',
  navy: 'Navy',
  turquoise: 'Turquoise',
  green: 'Green',
  grey: 'Grey',
  black: 'Black',
};

const BY_NAME = new Map<string, StringColourId>([
  ...STRING_PALETTE.map((id) => [PALETTE_EN[id].toLowerCase(), id] as const),
  ...STRING_PALETTE.map((id) => [id, id] as const),
  ['gray', 'grey'],
  ['fluo yellow', 'fluo_yellow'],
  ['neon yellow', 'fluo_yellow'],
]);

/**
 * A colour as a job or the catalog spells it, as a palette id — `null` for a
 * two-tone ("White/Yellow") or anything the palette does not name. Case and
 * surrounding space are ignored.
 */
export function colourIdOf(name: string | null | undefined): StringColourId | null {
  if (typeof name !== 'string') return null;
  return BY_NAME.get(name.trim().toLowerCase().replace(/\s+/g, ' ')) ?? null;
}
