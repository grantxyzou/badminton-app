import { activeRacket } from './activeRacket';
import { CLUB_GEAR_MIN_COHORT, type ClubGearEntry } from './clubGear';
import type { ClubTensionBand } from './clubTension';
import type { CatalogItem, GearItem, PlayerGear } from './types';

/**
 * "Answer 'what are you playing?'" — the share card's facts (design
 * "Equipment redesign" 2a screen 07, reworked).
 *
 * EVERY FIELD IS ONE THE MEMBER IS SHARING ON PURPOSE, AND NOTHING ELSE CAN
 * BE: no level, no results, no kudos, no arm history. The type has no field
 * for them. The club-relative numbers ("1 of 4", "+2 lb on the club's
 * average") are computed here, server-side, from the club reads — never on the
 * client from a partial cache — and each is null rather than zero when it
 * cannot honestly be said, so the card drops that line.
 */
export interface ShareCard {
  name: string;
  initial: string;
  /** The year the member joined the club, or null. */
  sinceYear: number | null;
  clubName: string | null;
  racket: { name: string; brand: string | null; weight: string | null; balance: string | null } | null;
  /** Restrings logged on the racket in play, and the date of the first. */
  restrings: { count: number; since: string } | null;
  /** Whole pounds above (+) or below (−) the club's average for this frame. */
  tensionVsClub: number | null;
  string: string | null;
  tensionLbs: number | null;
  grip: string | null;
  /** How many club members play this frame, the member included — "1 of N". */
  clubCount: number | null;
}

export interface ShareCardInput {
  name: string;
  joinedAt: string | null;
  clubName: string | null;
  gear: PlayerGear | null;
  racketRow: CatalogItem | null;
  /** The newest string's catalog row, for its model name ("BG65 Ti"). */
  stringRow?: CatalogItem | null;
  clubEntries: ClubGearEntry[];
  band: ClubTensionBand | null;
}

function text(item: CatalogItem | null, key: string): string | null {
  const v = item?.attributes?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function newestString(gear: PlayerGear | null): GearItem | null {
  let latest: GearItem | null = null;
  for (const i of gear?.items ?? []) if (i && !i.retiredAt && i.category === 'string') latest = i;
  return latest;
}

export function buildShareCard(input: ShareCardInput): ShareCard {
  const { gear, racketRow, band } = input;
  const racket = activeRacket(gear);
  const string = newestString(gear);
  const tensionLbs = typeof string?.tensionLbs === 'number' ? string.tensionLbs : null;

  const log = racket ? (gear?.stringLog ?? []).filter((e) => e.racketItemId === racket.id) : [];
  const restrings = log.length > 0 ? { count: log.length, since: log[0].at } : null;

  const key = racket?.label.trim().toLowerCase();
  const entry = key ? input.clubEntries.find((e) => e.category === 'racket' && e.label.trim().toLowerCase() === key) : undefined;
  const clubCount = entry && entry.count >= CLUB_GEAR_MIN_COHORT ? entry.count : null;

  const tensionVsClub = band && tensionLbs !== null && band.sampleSize >= CLUB_GEAR_MIN_COHORT
    ? Math.round(tensionLbs - band.mean)
    : null;

  const joined = input.joinedAt ? new Date(input.joinedAt) : null;
  const trimmed = input.name.trim();

  return {
    name: trimmed,
    initial: trimmed.charAt(0).toUpperCase(),
    sinceYear: joined && !Number.isNaN(joined.getTime()) ? joined.getUTCFullYear() : null,
    clubName: input.clubName,
    racket: racket
      ? {
        name: racketRow?.model ?? racket.label,
        brand: racketRow?.brand ?? null,
        weight: text(racketRow, 'weight'),
        balance: text(racketRow, 'balance'),
      }
      : null,
    restrings,
    tensionVsClub,
    string: string ? (input.stringRow?.model ?? string.label) : null,
    tensionLbs,
    grip: typeof gear?.fitGrip === 'string' ? gear.fitGrip : null,
    clubCount,
  };
}

export interface ShareCardWords {
  title: string;
  since: (year: number) => string;
  restrings: (count: number, since: string) => string;
  vsClub: (delta: number) => string;
  of: (count: number) => string;
  racket: string;
  strings: string;
  tension: string;
  grip: string;
  atClub: string;
  lb: string;
  footer: string;
}

/** "Copy as text": the same facts as the image, one per line, no art. */
export function shareCardText(card: ShareCard, w: ShareCardWords): string {
  const lines = [w.title];
  if (card.sinceYear !== null) lines.push(w.since(card.sinceYear));
  if (card.racket) {
    const spec = [card.racket.brand, card.racket.weight, card.racket.balance?.toLowerCase()].filter(Boolean).join(' · ');
    lines.push(`${w.racket}: ${card.racket.name}${spec ? ` (${spec})` : ''}`);
  }
  if (card.string) lines.push(`${w.strings}: ${card.string}`);
  if (card.tensionLbs !== null) lines.push(`${w.tension}: ${card.tensionLbs} ${w.lb}`);
  if (card.grip) lines.push(`${w.grip}: ${card.grip}`);
  if (card.restrings) lines.push(w.restrings(card.restrings.count, card.restrings.since));
  if (card.tensionVsClub !== null) lines.push(w.vsClub(card.tensionVsClub));
  if (card.clubCount !== null) lines.push(`${w.atClub}: ${w.of(card.clubCount)}`);
  lines.push(w.footer);
  return lines.join('\n');
}
