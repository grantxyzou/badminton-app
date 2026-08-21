import { CLUB_GEAR_MIN_COHORT, type ClubGearEntry } from './clubGear';
import type { CatalogItem } from './types';

/**
 * Build the "why this" lines for a recommended item.
 *
 * Pure: no fetch, no DB, no clock, no randomness — every input is passed in, so
 * the privacy behaviour below is directly unit-testable.
 *
 * Two permitted sources, in priority order: the engine's own equipment-derived
 * reasons, and the club tally. Nothing else may appear in a reason. (The
 * catalog spec line is NOT a source here — per the design artboard it is a
 * separate display line on the sheet, rendered above this list, not a why-this
 * reason.)
 *
 * DRILLS ARE NOT A SOURCE, deliberately (2026-08-21). They used to be, under a
 * rule that capped the engine at one slot whenever a drill line existed — and
 * since `GearPickSheet` renders `reasons[0]` as its headline and only
 * `reasons.slice(1)` under WHY THIS, that cap made "You are working on drops —
 * slow-drop target zones is in this week's focus" the ENTIRE visible why-this
 * list. A gear recommendation answers "does this suit how you play", and a
 * drill answers "what are you trying to fix"; nothing here computes a
 * relationship between the two, so the line was an invented connection sitting
 * where the actual grounding should be. The string branch of `/api/recommend`
 * had already reached that conclusion on its own and passed no drills at all.
 * The engine's reasons ARE the play-style grounding — balance, style, format
 * and tier are exactly "who you are as a player" — so they lead and they fill.
 *
 * The club tally stays: it is real evidence about the item rather than a claim
 * about the member, but it is evidence of popularity, not of fit, so it takes
 * at most one slot and always the last one.
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
  /** Club tally entries. MUST come from `tallyClubGear`; re-filtered anyway. */
  clubEntries: ClubGearEntry[];
  /** Cap on returned reasons. The sheet shows a short list, not an essay. */
  limit?: number;
}

export function buildPickReasons(input: PickReasonInput): string[] {
  const { item, engineReasons, clubEntries, limit = 3 } = input;

  const safeClub = clubEntries.filter(
    (e) => e && e.category === item.category && typeof e.count === 'number' && e.count >= CLUB_GEAR_MIN_COHORT,
  );
  const match = safeClub.find((e) => e.label === `${item.brand} ${item.model}` || e.label === item.model);
  const clubLine = match ? `${match.count} people in the club already play it` : null;

  // The club line is reserved a slot rather than appended and truncated away:
  // reserving costs the engine its weakest reason, appending cost the club line
  // its existence whenever the engine produced a full list (which it usually
  // does — flex + balance + category + format is four before tier and budget).
  const engineCap = clubLine ? Math.max(1, limit - 1) : limit;

  const out: string[] = [];
  for (const r of engineReasons) {
    if (out.length >= engineCap) break;
    if (typeof r === 'string' && r.trim()) out.push(r.trim());
  }
  if (clubLine) out.push(clubLine);

  return out.slice(0, limit);
}
