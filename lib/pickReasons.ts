import { CLUB_GEAR_MIN_COHORT, type ClubGearEntry } from './clubGear';
import type { DrillPick } from './drills';
import type { CatalogItem } from './types';

/**
 * Build the "why this" lines for a recommended item.
 *
 * Pure: no fetch, no DB, no clock, no randomness — every input is passed in, so
 * the privacy behaviour below is directly unit-testable.
 *
 * Four permitted sources, in priority order: the engine's own equipment-derived
 * reasons, the member's current drill picks, the catalog spec line, and the club
 * tally. Nothing else may appear in a reason.
 *
 * THE CLUB GUARD IS RE-APPLIED HERE ON PURPOSE. `tallyClubGear` already drops
 * entries below CLUB_GEAR_MIN_COHORT, so this is defence in depth rather than
 * the only check — but a reason is a NEW disclosure surface for that data, and
 * "the caller filtered it" is not a property the type system enforces. One
 * unfiltered caller and a tally becomes an identification.
 */
export interface PickReasonInput {
  item: CatalogItem;
  /** Equipment-derived reasons from the scoring engine, best first. */
  engineReasons: string[];
  /** The member's current drill picks, for cross-domain grounding. */
  drills: DrillPick[];
  /** Club tally entries. MUST come from `tallyClubGear`; re-filtered anyway. */
  clubEntries: ClubGearEntry[];
  /** Cap on returned reasons. The sheet shows a short list, not an essay. */
  limit?: number;
}

export function buildPickReasons(input: PickReasonInput): string[] {
  const { item, engineReasons, drills, clubEntries, limit = 3 } = input;
  const out: string[] = [];

  for (const r of engineReasons) {
    if (typeof r === 'string' && r.trim()) out.push(r.trim());
  }

  // Cross-domain: name what they are actually practising. Uses the drill's own
  // skill label, never a rating number — the sheet is not a report card.
  const drill = drills.find((d) => d && typeof d.title === 'string');
  if (drill) {
    out.push(`You are working on ${drill.skillLabel.toLowerCase()} — ${drill.title.toLowerCase()} is in this week's focus`);
  }

  const safeClub = clubEntries.filter(
    (e) => e && e.category === item.category && typeof e.count === 'number' && e.count >= CLUB_GEAR_MIN_COHORT,
  );
  const match = safeClub.find((e) => e.label === `${item.brand} ${item.model}` || e.label === item.model);
  if (match) {
    out.push(`${match.count} people in the club already play it`);
  }

  return out.slice(0, limit);
}
