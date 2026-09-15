import type { CatalogItem, EquipmentCategory, GearItem, PlayerGear, RacketFeel } from './types';
import type { ClubGearEntry } from './clubGear';
import { activeRacket } from './activeRacket';

/**
 * The Set-up card's arithmetic (`NEXT_PUBLIC_FLAG_GEAR_SETUP`): which item
 * fills each line, how a line describes itself, and the one club fact a
 * filled line may carry. Pure and DOM-free so the privacy rule on the club
 * fact is tested as arithmetic, not as rendered text.
 */

/** The two lines the card asks for. Shoes and shuttles have no catalog rows,
 *  so they are not lines — a card that cannot be completed is homework. */
export const SETUP_CATEGORIES = ['racket', 'string'] as const;
export type SetupCategory = (typeof SETUP_CATEGORIES)[number];

export interface SetupLines {
  /** The racket in play: the explicit pointer, or the legacy first racket. */
  racket: GearItem | null;
  /** Every other live racket, in the order they were added. */
  spares: GearItem[];
  /** The newest live string. `items` is append-ordered, so the last one is
   *  what is on the racket now — `YourKitCard` learned that the hard way. */
  string: GearItem | null;
  /** 0, 1 or 2 — how many of the two lines hold something. */
  filled: number;
}

function categoryOf(item: GearItem): EquipmentCategory {
  return (item.category ?? 'racket') as EquipmentCategory;
}

export function setupLines(gear: PlayerGear | null): SetupLines {
  const live = (gear?.items ?? []).filter((i): i is GearItem => !!i && !i.retiredAt);
  const racket = activeRacket(gear);
  const spares = live.filter((i) => categoryOf(i) === 'racket' && i.id !== racket?.id);
  let string: GearItem | null = null;
  for (const i of live) if (categoryOf(i) === 'string') string = i;
  return { racket, spares, string, filled: (racket ? 1 : 0) + (string ? 1 : 0) };
}

/** Catalog rows by id, for the spec lines. */
export function indexCatalog(items: CatalogItem[]): Map<string, CatalogItem> {
  return new Map(items.map((c) => [c.id, c]));
}

function text(item: CatalogItem, key: string): string | null {
  const v = item.attributes?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * "4U · even" — weight class, then balance. The weight class stays as the
 * catalog gives it ("3U/4U"): the member's own frame could be either, and
 * printing one would invent a spec.
 */
export function racketSpecLine(item: CatalogItem | undefined): string | null {
  if (!item) return null;
  const parts = [text(item, 'weight'), text(item, 'balance')?.toLowerCase() ?? null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** String character, as the catalog's `stringType` → a `stats.gear.setup` key. */
const STRING_TYPE_KEY: Record<string, string> = {
  durability: 'typeDurable',
  repulsion: 'typeRepulsion',
  control: 'typeControl',
  hybrid: 'typeHybrid',
  'all-round': 'typeAllRound',
};

/**
 * "0.70mm · durable". `word` maps a `STRING_TYPE_KEY` suffix to its label
 * (the caller owns translation); an unrecognised type is omitted rather than
 * printed raw in the wrong language.
 */
export function stringSpecLine(item: CatalogItem | undefined, word: (key: string) => string): string | null {
  if (!item) return null;
  const gauge = item.attributes?.gaugeMm;
  const type = text(item, 'stringType')?.toLowerCase();
  const typeKey = type ? STRING_TYPE_KEY[type] : undefined;
  const parts = [
    typeof gauge === 'number' && Number.isFinite(gauge) ? `${gauge.toFixed(2)}mm` : null,
    typeKey ? word(typeKey) : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** EXACTLY `tallyClubGear`'s key. A looser match here (collapsing spaces,
 *  folding punctuation) would pair a line with an entry the tally counts as a
 *  different item — a fact keyed differently from the count it reports. */
function normalise(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * How many OTHER members play this item, or null when that must not be said.
 *
 * Reads ONLY the tally `/api/stats/club/gear` returned, which `tallyClubGear`
 * has already cut at `CLUB_GEAR_MIN_COHORT`. Below the cohort there is no
 * entry, so there is no number — never a count computed here, which would be
 * a second, unguarded way to learn that one other person owns a racket.
 *
 * The member is counted in the entry (they own the item — that is why the
 * line is filled), so the fact is `count - 1`. A tally that has not caught up
 * with a racket added a moment ago simply has no entry yet: null, not zero.
 */
export function clubOthers(entries: ClubGearEntry[] | null, item: GearItem | null): number | null {
  if (!entries || !item) return null;
  const key = normalise(item.label);
  const cat = categoryOf(item);
  const entry = entries.find((e) => e.category === cat && normalise(e.label) === key);
  if (!entry) return null;
  const others = entry.count - 1;
  return others > 0 ? others : null;
}

/** Whether a tally entry is one of the member's own live items — the
 *  " · yours" mark on "What the club plays". */
export function isMine(gear: PlayerGear | null, entry: ClubGearEntry): boolean {
  const key = normalise(entry.label);
  return (gear?.items ?? []).some(
    (i) => !!i && !i.retiredAt && categoryOf(i) === entry.category && normalise(i.label) === key,
  );
}

/** The part of a recommend pick the card reads — structural, so this file
 *  stays free of component imports. */
export interface SetupStringPick {
  status: string;
  pick: {
    item: { id: string; model: string };
    tensionLbs?: number | null;
    /** The frame the server paired against, as it reported it. */
    pairedWith?: { label: string; source: 'owned' | 'recommended' };
  } | null;
}

/**
 * The pairing the BLANK strings line quotes, or null.
 *
 * Only once there is a racket to pair with (the design's "for this frame"),
 * only while there is no string yet, only from a READY pick — a parked or
 * errored card has nothing to say here — and only when that pick was paired
 * with the racket on the line.
 */
export function blankStringPairing(lines: SetupLines, stringPick: SetupStringPick): SetupStringPick['pick'] {
  if (!lines.racket || lines.string) return null;
  if (stringPick.status !== 'ready' || !stringPick.pick) return null;
  // "For THIS frame" is a claim, so it needs the server to have paired
  // against THIS frame: the member's own racket, by the label it reported.
  // The picks are not refetched on every bag change, so a pairing made for
  // the racket in play a minute ago would otherwise be quoted under the new
  // one — and a free-text racket the catalog cannot resolve pairs against a
  // RECOMMENDED frame, which is not the member's at all.
  const paired = stringPick.pick.pairedWith;
  if (!paired || paired.source !== 'owned') return null;
  if (normalise(paired.label) !== normalise(lines.racket.label)) return null;
  return stringPick.pick;
}

/**
 * Whether the card is showing a string TENSION number — the pairing's, on the
 * blank line, or the member's own, on a filled one.
 *
 * `StringTensionCard` stands down exactly when this is true, and must read it
 * from HERE, not from "the pairing has a number". Those are different: with no
 * racket in the bag the string engine still pairs against the RECOMMENDED
 * frame and returns a tension, the card quotes nothing (there is no frame on
 * the card), and keying the stand-down on the pick alone left the register
 * with no tension number anywhere on screen. Found by looking, 2026-09-14.
 */
export function tensionOnScreen(lines: SetupLines, stringPick: SetupStringPick): boolean {
  if (typeof lines.string?.tensionLbs === 'number') return true;
  return typeof blankStringPairing(lines, stringPick)?.tensionLbs === 'number';
}

/** Each feel answer → its `stats.gear.setup` word key. Weight classes are
 *  printed as they are ("4U"); they read the same in every language. */
export const FEEL_WORD_KEY: Record<string, string> = {
  'Head-heavy': 'feelHeadHeavy',
  Even: 'feelEven',
  'Head-light': 'feelHeadLight',
  Stiff: 'feelStiff',
  Medium: 'feelMedium',
  Flexible: 'feelFlexible',
};

/**
 * A typed-in racket's line in the member's own words: "4U · head-heavy ·
 * stiff", in the same order as a catalog row's spec. Null when nothing was
 * answered — an unanswered racket has no spec, not a blank one.
 */
export function racketFeelLine(feel: RacketFeel | undefined, word: (key: string) => string): string | null {
  if (!feel) return null;
  const parts = [
    feel.weight ?? null,
    feel.balance ? word(FEEL_WORD_KEY[feel.balance]).toLowerCase() : null,
    feel.flex ? word(FEEL_WORD_KEY[feel.flex]).toLowerCase() : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** A picker row's spec: "3U · head-heavy · stiff". A string row reuses
 *  `stringSpecLine`. */
export function racketRowSpec(item: CatalogItem): string | null {
  const parts = [text(item, 'weight'), text(item, 'balance')?.toLowerCase() ?? null, text(item, 'flex')?.toLowerCase() ?? null]
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** Everything a shared set-up may carry — and nothing else. The share card
 *  and its text are built ONLY from this, so a level, a game count or a
 *  kudos tally cannot reach them by accident: there is no field to put it in. */
export interface SetupShare {
  name: string;
  racket: string | null;
  string: string | null;
  tensionLbs: number | null;
}

export function setupShare(name: string, lines: SetupLines): SetupShare {
  return {
    name,
    racket: lines.racket?.label ?? null,
    string: lines.string?.label ?? null,
    tensionLbs: typeof lines.string?.tensionLbs === 'number' ? lines.string.tensionLbs : null,
  };
}

/**
 * The catalog racket a club tally row names, keyed exactly as the tally keys
 * (a catalog racket's label is "Brand Model"), or null — a typed-in name has no
 * page to open. Built once per catalog, looked up per row.
 */
export function racketIdsByTallyKey(rackets: Array<{ id: string; category: string; brand: string; model: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rackets) if (r.category === 'racket') out.set(normalise(`${r.brand} ${r.model}`), r.id);
  return out;
}

export function tallyEntryRacketId(entry: ClubGearEntry, ids: Map<string, string>): string | null {
  return entry.category === 'racket' ? ids.get(normalise(entry.label)) ?? null : null;
}
