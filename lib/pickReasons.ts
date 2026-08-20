import { CLUB_GEAR_MIN_COHORT, type ClubGearEntry } from './clubGear';
import type { DrillPick } from './drills';
import type { CatalogItem } from './types';

/**
 * Build the "why this" lines for a recommended item.
 *
 * Pure: no fetch, no DB, no clock, no randomness — every input is passed in, so
 * the privacy behaviour below is directly unit-testable.
 *
 * Three permitted sources, in priority order: the engine's own equipment-derived
 * reasons, the member's current drill picks, and the club tally. Nothing else
 * may appear in a reason. (The catalog spec line is NOT a source here — per the
 * design artboard it is a separate display line on the sheet, rendered above
 * this list, not a why-this reason.)
 *
 * THE CLUB GUARD IS RE-APPLIED HERE ON PURPOSE. `tallyClubGear` already drops
 * entries below CLUB_GEAR_MIN_COHORT, so this is defence in depth rather than
 * the only check — but a reason is a NEW disclosure surface for that data, and
 * "the caller filtered it" is not a property the type system enforces. One
 * unfiltered caller and a tally becomes an identification.
 *
 * R6 — cross-source representation is guaranteed, not merely possible. The
 * scoring engine alone routinely produces 3+ equipment reasons (flex, balance,
 * category, ...), which would otherwise fill every slot up to `limit` before
 * the drill or club line is ever appended — three restatements of the spec
 * sheet the member could read for themselves. The design intent is that this
 * list surfaces grounding the member could NOT read off the spec sheet (the
 * plain equipment line lives separately, above this list). So: when a drill
 * or club line is available, the engine gets AT MOST ONE slot. Only when
 * neither has anything to say does the engine fill every slot — an
 * equipment-only list beats an empty one.
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

  // Cross-domain: name what they are actually practising. Uses the drill's own
  // skill label, never a rating number — the sheet is not a report card.
  const drill = drills.find((d) => d && typeof d.title === 'string');
  const drillLine = drill
    ? `You are working on ${drill.skillLabel.toLowerCase()} — ${drill.title.toLowerCase()} is in this week's focus`
    : null;

  const safeClub = clubEntries.filter(
    (e) => e && e.category === item.category && typeof e.count === 'number' && e.count >= CLUB_GEAR_MIN_COHORT,
  );
  const match = safeClub.find((e) => e.label === `${item.brand} ${item.model}` || e.label === item.model);
  const clubLine = match ? `${match.count} people in the club already play it` : null;

  // R6: cap the engine at one slot whenever there is real cross-domain
  // grounding to show; only fall back to filling every slot from the engine
  // when neither drill nor club produced a line.
  const hasCrossDomain = drillLine !== null || clubLine !== null;
  const engineCap = hasCrossDomain ? 1 : Infinity;

  const out: string[] = [];
  for (const r of engineReasons) {
    if (out.length >= engineCap) break;
    if (typeof r === 'string' && r.trim()) out.push(r.trim());
  }
  if (drillLine) out.push(drillLine);
  if (clubLine) out.push(clubLine);

  return out.slice(0, limit);
}
