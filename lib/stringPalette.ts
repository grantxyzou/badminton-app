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

// ── Reel colours beyond the palette (docs/plans/string-stock-by-colour.md,
//    Decisions, 2026-11-12: "two colour combo like aerobites, and custom
//    picker for future"). Both are first-class ids, so every place that
//    already stores or counts a palette id — the shelf's reel colours, a
//    purchase's `color`, the per-colour stock — takes them unchanged.
//
//    custom:<rrggbb>   a club's own colour. The id IS its hex (lowercase, no
//                      `#`), so any reader can draw it without the club's
//                      list; the NAME lives on the club's strings doc
//                      (`OfferedStringsDoc.customColours`). One colour per
//                      hex in a club: two that draw the same are one colour.
//    combo:<m>+<c>     a two-colour set, MAINS first, each part a palette or
//                      custom id, never the same twice. Its English name is
//                      "<mains> / <crosses>", which is what a job stores.

export type CustomColourId = `custom:${string}`;
export type ComboColourId = `combo:${string}`;
/** Anything a reel can be: a palette colour, the club's own, or a two-colour set. */
export type ReelColourId = StringColourId | CustomColourId | ComboColourId;
/** A single colour: a palette one or the club's own (a combo's part). */
export type SingleColourId = StringColourId | CustomColourId;

/** A club's own colour, stored on its strings doc. `hex` is `#rrggbb`, lowercase. */
export interface CustomColour {
  id: CustomColourId;
  name: string;
  hex: string;
}

export const MAX_CUSTOM_NAME_LEN = 30;
/** More than a club will name; a cap so the strings doc stays small. */
export const MAX_CUSTOM_COLOURS = 24;

const CUSTOM_RE = /^custom:[0-9a-f]{6}$/;

export function isCustomColourId(v: unknown): v is CustomColourId {
  return typeof v === 'string' && CUSTOM_RE.test(v);
}

export function isSingleColourId(v: unknown): v is SingleColourId {
  return isStringColourId(v) || isCustomColourId(v);
}

/** `#RRGGBB` / `rrggbb` → `#rrggbb`; anything else `null`. */
export function normaliseHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

/** The id a colour of this hex takes; `null` for a hex that is not `#rrggbb`. */
export function customIdOf(hex: string): CustomColourId | null {
  const h = normaliseHex(hex);
  return h ? (`custom:${h.slice(1)}` as CustomColourId) : null;
}

/** A custom id's colour, `#rrggbb`. */
export function hexOfCustom(id: CustomColourId): string {
  return `#${id.slice('custom:'.length)}`;
}

/** The set's id, mains first; `null` unless both are single colours and differ. */
export function comboIdOf(mains: unknown, crosses: unknown): ComboColourId | null {
  if (!isSingleColourId(mains) || !isSingleColourId(crosses) || mains === crosses) return null;
  return `combo:${mains}+${crosses}` as ComboColourId;
}

/** A combo id's two parts, mains first; `null` for anything that is not one. */
export function comboParts(v: unknown): { mains: SingleColourId; crosses: SingleColourId } | null {
  if (typeof v !== 'string' || !v.startsWith('combo:')) return null;
  const parts = v.slice('combo:'.length).split('+');
  if (parts.length !== 2) return null;
  const [mains, crosses] = parts;
  return comboIdOf(mains, crosses) === v ? { mains: mains as SingleColourId, crosses: crosses as SingleColourId } : null;
}

export function isComboColourId(v: unknown): v is ComboColourId {
  return comboParts(v) !== null;
}

export function isReelColourId(v: unknown): v is ReelColourId {
  return isSingleColourId(v) || isComboColourId(v);
}

/**
 * A submitted colour list cleaned: reel colour ids only — palette ones first
 * in palette order, then the sets and the club's own in the order sent — no
 * repeats, capped. With `customIds`, a club colour (alone or in a set) that
 * the club has not defined is dropped too; that is the server's reading. A
 * list of palette ids alone reads exactly as it always did.
 */
export function normaliseColourList(value: unknown, customIds?: ReadonlySet<string>): ReelColourId[] {
  if (!Array.isArray(value)) return [];
  const known = (id: SingleColourId) => !customIds || !isCustomColourId(id) || customIds.has(id);
  const ok = (v: unknown): v is ReelColourId => {
    if (isSingleColourId(v)) return known(v);
    const parts = comboParts(v);
    return !!parts && known(parts.mains) && known(parts.crosses);
  };
  const wanted = new Set<ReelColourId>(value.filter(ok));
  const palette: ReelColourId[] = STRING_PALETTE.filter((id) => wanted.has(id));
  const rest = [...wanted].filter((id) => !isStringColourId(id));
  return [...palette, ...rest].slice(0, MAX_COLOURS_PER_STRING);
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

const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/** One colour by name: the palette's (and its spellings), else the club's own. */
function singleIdOf(name: string, customs: readonly CustomColour[]): SingleColourId | null {
  const key = nameKey(name);
  if (!key) return null;
  return BY_NAME.get(key) ?? customs.find((c) => nameKey(c.name) === key)?.id ?? null;
}

/**
 * A colour as a job or the catalog spells it, as a reel colour id — `null`
 * for anything nobody names. Case and surrounding space are ignored. A
 * two-tone, "Red / White" or the catalog's "Red/White", is a set with the
 * FIRST named as the mains (`combo:red+white`); `customs` is the club's own
 * colours, matched by name.
 */
export function colourIdOf(name: string | null | undefined, customs: readonly CustomColour[] = []): ReelColourId | null {
  if (typeof name !== 'string') return null;
  if (name.includes('/')) {
    const parts = name.split('/');
    if (parts.length !== 2) return null;
    return comboIdOf(singleIdOf(parts[0], customs), singleIdOf(parts[1], customs));
  }
  return singleIdOf(name, customs);
}

/**
 * The STORED English name of a reel colour — what a job's `stringColor` says
 * and the bench reads: the palette's word, the club's own name as typed, or
 * "<mains> / <crosses>". `null` for a club colour the club has no name for.
 */
export function reelColourEnglish(id: ReelColourId, customs: readonly CustomColour[] = []): string | null {
  if (isStringColourId(id)) return PALETTE_EN[id];
  if (isCustomColourId(id)) return customs.find((c) => c.id === id)?.name ?? null;
  const parts = comboParts(id);
  if (!parts) return null;
  const mains = reelColourEnglish(parts.mains, customs);
  const crosses = reelColourEnglish(parts.crosses, customs);
  return mains && crosses ? `${mains} / ${crosses}` : null;
}

// ── A club's own colours: reading and adding ────────────────────────────────

export type CustomColourError = 'invalid_colour_name' | 'colour_name_taken' | 'invalid_hex' | 'colour_taken' | 'too_many_colours';

/** A stored list cleaned for reading: well-formed entries, one per id and per name. */
export function normaliseCustomColours(value: unknown): CustomColour[] {
  if (!Array.isArray(value)) return [];
  const out: CustomColour[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, name, hex } = raw as Record<string, unknown>;
    const h = normaliseHex(hex);
    if (!h || typeof name !== 'string' || !name.trim() || id !== customIdOf(h)) continue;
    if (out.some((c) => c.id === id || nameKey(c.name) === nameKey(name))) continue;
    out.push({ id: id as CustomColourId, name: name.trim().slice(0, MAX_CUSTOM_NAME_LEN), hex: h });
    if (out.length >= MAX_CUSTOM_COLOURS) break;
  }
  return out;
}

/**
 * Why a new colour cannot join the club's, or `null` when it can. The name:
 * 1–30 characters, no "/" (that is how a set is written), not a palette
 * colour's name, not one the club already has (any case). The hex: `#rrggbb`,
 * not one the club already has a colour for.
 */
export function customColourError(existing: readonly CustomColour[], name: unknown, hex: unknown): CustomColourError | null {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n || n.length > MAX_CUSTOM_NAME_LEN || n.includes('/') || BY_NAME.has(nameKey(n))) return 'invalid_colour_name';
  const h = normaliseHex(hex);
  if (!h) return 'invalid_hex';
  if (existing.some((c) => nameKey(c.name) === nameKey(n))) return 'colour_name_taken';
  if (existing.some((c) => c.hex === h)) return 'colour_taken';
  if (existing.length >= MAX_CUSTOM_COLOURS) return 'too_many_colours';
  return null;
}

/**
 * New colours added to the club's: `value` is `[{ name, hex }]`. All or none —
 * one bad entry refuses the lot. Sending one the club already has, same name
 * and hex, is a no-op, so a retried Save never fails on its own first try.
 */
export function addCustomColours(
  existing: readonly CustomColour[],
  value: unknown,
): { ok: true; value: CustomColour[] } | { ok: false; error: CustomColourError } {
  if (!Array.isArray(value)) return { ok: false, error: 'invalid_colour_name' };
  const out = [...existing];
  for (const raw of value) {
    const { name, hex } = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const h = normaliseHex(hex);
    const same = out.find((c) => c.hex === h);
    if (same && typeof name === 'string' && nameKey(same.name) === nameKey(name)) continue;
    const error = customColourError(out, name, hex);
    if (error) return { ok: false, error };
    out.push({ id: customIdOf(h as string) as CustomColourId, name: (name as string).trim(), hex: h as string });
  }
  return { ok: true, value: out };
}
