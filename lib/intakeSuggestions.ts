import type { GearItem, PlayerGear, StringingJob } from './types';
import { setupLines } from './gearSetup';

/**
 * What the New job form offers once a player is picked: the rackets in their
 * bag and the string on them, with its tension, plus whatever the bench strung
 * for them last time. One tap fills a field; typing anything else is still
 * allowed, so these are suggestions, never a list to choose from.
 *
 * Pure: the form fetches, this decides. Labels are deduped case-insensitively
 * so a racket in the bag and the same racket on the last job show once.
 */

export interface RacketSuggestion {
  label: string;
  /** The racket the player marked as the one they use. */
  inPlay: boolean;
}

export interface StringSuggestion {
  label: string;
  /** Absent when nobody recorded a tension: picking it leaves the steppers alone. */
  mains?: number;
  crosses?: number;
  /** Where it came from: the bench's own last job, or the player's bag. */
  source: 'lastJob' | 'bag';
}

export interface IntakeSuggestions {
  rackets: RacketSuggestion[];
  strings: StringSuggestion[];
}

/** The common habit, and the form's own 26 / 28 default: crosses two pounds over. */
export const CROSSES_OVER_MAINS = 2;

const key = (s: string) => s.trim().toLowerCase();

/** The player's newest job, archived or not. */
export function lastJobFor(jobs: StringingJob[], memberId: string): StringingJob | null {
  let newest: StringingJob | null = null;
  for (const j of jobs) {
    if (j.memberId !== memberId) continue;
    if (!newest || j.createdAt > newest.createdAt) newest = j;
  }
  return newest;
}

function bagString(item: GearItem): StringSuggestion | null {
  const label = item.label?.trim();
  if (!label) return null;
  const crossLabel = item.crosses?.label?.trim();
  const mains = typeof item.tensionLbs === 'number' ? item.tensionLbs : undefined;
  const crosses = typeof item.crosses?.tensionLbs === 'number'
    ? item.crosses.tensionLbs
    : mains !== undefined ? mains + CROSSES_OVER_MAINS : undefined;
  return {
    // A hybrid is one job: both strings on the one label.
    label: crossLabel && key(crossLabel) !== key(label) ? `${label} / ${crossLabel}` : label,
    ...(mains !== undefined ? { mains, crosses } : {}),
    source: 'bag',
  };
}

export function intakeSuggestions(gear: PlayerGear | null, lastJob: StringingJob | null): IntakeSuggestions {
  const lines = setupLines(gear);
  const rackets: RacketSuggestion[] = [];
  const seenRackets = new Set<string>();
  const addRacket = (label: string | undefined, inPlay: boolean) => {
    const l = label?.trim();
    if (!l || seenRackets.has(key(l))) return;
    seenRackets.add(key(l));
    rackets.push({ label: l, inPlay });
  };
  if (lines.racket && !lines.racket.retiredAt) addRacket(lines.racket.label, true);
  for (const r of lines.spares) addRacket(r.label, false);
  addRacket(lastJob?.racketLabel, false);

  const strings: StringSuggestion[] = [];
  const seenStrings = new Set<string>();
  const addString = (s: StringSuggestion | null) => {
    if (!s || seenStrings.has(key(s.label))) return;
    seenStrings.add(key(s.label));
    strings.push(s);
  };
  // The bench's own record first: it has both tensions, as strung.
  if (lastJob?.stringLabel?.trim()) {
    addString({ label: lastJob.stringLabel.trim(), mains: lastJob.tensionMains, crosses: lastJob.tensionCrosses, source: 'lastJob' });
  }
  if (lines.string) addString(bagString(lines.string));
  return { rackets, strings };
}

/** The suggestions still worth showing under a field: those containing what is typed, never the one already there. */
export function matchingSuggestions<T extends { label: string }>(list: T[], typed: string): T[] {
  const q = key(typed);
  return list.filter((s) => key(s.label) !== q && (!q || key(s.label).includes(q)));
}
