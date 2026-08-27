/**
 * Stringing jobs — the rules the bench and the player side must agree on.
 *
 * Pure: no Cosmos, no clock beyond what callers pass in, no React. Both the
 * API routes and the UI import from here so the two audiences cannot drift
 * apart, which is the single most important property of this feature.
 *
 * TWO AUDIENCES, TWO VOCABULARIES — DELIBERATELY
 * ----------------------------------------------
 * The bench tracks a job through `requested → received → strung → ready →
 * picked_up`. The player never sees any of those words. They see "Grant has
 * it", "Being strung", "Ready for you", "Picked up" — language about THEIR
 * racket rather than about someone else's workflow.
 *
 * This is not a translation layer for its own sake. "Received" is a fact about
 * the bench and reads as bureaucracy to the person who just handed over a
 * racket; and once the two vocabularies share a type, the next status added
 * for the bench's convenience leaks to the player by default. Keeping them
 * separate makes leaking the deliberate act rather than the accidental one.
 */

export type StringingStatus = 'requested' | 'received' | 'strung' | 'ready' | 'picked_up';

/** Bench order. Also the only legal forward path — see `canTransition`. */
export const STRINGING_FLOW: readonly StringingStatus[] = [
  'requested',
  'received',
  'strung',
  'ready',
  'picked_up',
] as const;

export function isStringingStatus(value: unknown): value is StringingStatus {
  return typeof value === 'string' && (STRINGING_FLOW as readonly string[]).includes(value);
}

/**
 * Any status may move to any other.
 *
 * Deliberately permissive, and the reason is the bench rather than the model:
 * a racket gets handed back before it is paid for, a job gets marked strung by
 * mistake, someone taps the wrong row. A strict forward-only machine would
 * make the app wrong about the physical world and give the stringer no way to
 * say so. What IS enforced is that the value is a known status at all.
 *
 * The audit trail is what carries the truth instead: every change appends to
 * `history`, so a correction is visible rather than silent.
 */
export function canTransition(from: StringingStatus, to: StringingStatus): boolean {
  return isStringingStatus(from) && isStringingStatus(to);
}

/**
 * Player-facing step, in the order the TRACK is drawn on the status screen.
 *
 * `ready_for_you`, not `ready`, and the extra word is load-bearing.
 *
 * `ready` is also a bench status, so the two unions would OVERLAP on it — and
 * overlapping string-literal unions are mutually assignable, meaning the
 * compiler would happily accept `job.status` wherever a `PlayerStage` is
 * expected and silently leak a bench word onto a player's screen for that one
 * value. Disjoint unions make that a type error instead of a code review.
 * It is also what the design calls the step.
 */
export type PlayerStage = 'with_stringer' | 'being_strung' | 'ready_for_you' | 'done';

export const PLAYER_TRACK: readonly PlayerStage[] = [
  'with_stringer',
  'being_strung',
  'ready_for_you',
  'done',
] as const;

/**
 * Bench status → player stage.
 *
 * `requested` and `received` both read as "with the stringer" on purpose. The
 * difference between them is a bench bookkeeping detail — whether the racket is
 * physically in hand yet — and surfacing it would invite the player to wonder
 * why their job is "only requested" when they handed the racket over in person.
 */
export function playerStageFor(status: StringingStatus): PlayerStage {
  switch (status) {
    case 'requested':
    case 'received':
      return 'with_stringer';
    case 'strung':
      return 'being_strung';
    case 'ready':
      return 'ready_for_you';
    case 'picked_up':
      return 'done';
  }
}

/** Index into PLAYER_TRACK, for drawing how far along the timeline is. */
export function playerStageIndex(status: StringingStatus): number {
  return PLAYER_TRACK.indexOf(playerStageFor(status));
}

/**
 * Width of the price band shown to players, in cents.
 *
 * WHY A QUANTISED BAND AND NOT A ± MARGIN. The obvious reading of the design's
 * "$30 exact → $28–32 shown" is a symmetric ±$2. That would defeat the whole
 * point: a symmetric band's MIDPOINT is the exact price, so every player could
 * recover the figure the band exists to hide.
 *
 * Snapping to a fixed $4 grid instead means several real prices share one band
 * — $28, $29, $30 and $31 all display as "$28–32" — so the band genuinely
 * carries less information than the price. It also reproduces the design's own
 * example exactly.
 */
export const PRICE_BAND_CENTS = 400;

export interface PriceBand {
  lowCents: number;
  highCents: number;
}

/**
 * The band a price falls in. Returns null for an absent price rather than a
 * band around zero — "not quoted yet" and "quoted at nothing" are different
 * things, and the UI says so differently.
 */
export function priceBand(priceCents: number | null | undefined): PriceBand | null {
  if (typeof priceCents !== 'number' || !Number.isFinite(priceCents) || priceCents < 0) {
    return null;
  }
  const low = Math.floor(priceCents / PRICE_BAND_CENTS) * PRICE_BAND_CENTS;
  return { lowCents: low, highCents: low + PRICE_BAND_CENTS };
}

/** "$28–32". Whole dollars: a band expressed to the cent would look exact. */
export function formatPriceBand(band: PriceBand | null): string | null {
  if (!band) return null;
  return `$${Math.round(band.lowCents / 100)}–${Math.round(band.highCents / 100)}`;
}

/** "$30.00" — the stringer's own view, never sent to a player. */
export function formatPriceExact(priceCents: number | null | undefined): string | null {
  if (typeof priceCents !== 'number' || !Number.isFinite(priceCents)) return null;
  return `$${(priceCents / 100).toFixed(2)}`;
}

/**
 * Tension bounds for what a STRINGER can enter.
 *
 * Wider than `lib/tension.ts`'s MIN_LB/MAX_LB (20–30) and that is not a
 * conflict: those bound a RECOMMENDATION made to a player who has not chosen,
 * where a cautious middle is the right answer. These bound what a machine can
 * actually be set to and what a player may genuinely ask for. Narrowing the
 * bench to the advisory range would make the app refuse a real, correct job.
 */
export const TENSION_MIN_LB = 18;
export const TENSION_MAX_LB = 32;

export function isValidTension(lb: unknown): lb is number {
  return (
    typeof lb === 'number' &&
    Number.isInteger(lb) &&
    lb >= TENSION_MIN_LB &&
    lb <= TENSION_MAX_LB
  );
}

/**
 * Sequential human-facing job number: `J-0042`.
 *
 * NOT an id. The document id stays a random hex string — a guessable
 * sequential id on a member-scoped document is an enumeration invitation, and
 * this one is printed on a physical tag that sits on a shelf where other
 * players can read it. The number exists so a stringer and a player can say
 * "forty-two" out loud, nothing more.
 */
export function formatJobNo(sequence: number): string {
  return `J-${String(Math.max(0, Math.trunc(sequence))).padStart(4, '0')}`;
}

/**
 * Crosses sit ABOVE mains, by 2 lb.
 *
 * Standard practice, not a preference: the cross strings are shorter and are
 * woven over and under the mains, so at equal reference tension they end up
 * looser in the finished bed. Adding a couple of pounds is what makes the two
 * planes feel matched. Two pounds is also roughly the 10% that stringers quote
 * as a rule of thumb at the tensions this club actually uses.
 *
 * This is why the simple request form shows ONE number. A player asking for
 * "26" means a 26/28 job, and making them enter both invites a pair that no
 * stringer would have chosen. Anyone who genuinely wants an unusual pair says
 * so through the custom path, which is exactly what that path is for.
 */
export const CROSS_OFFSET_LB = 2;

/** The crosses that go with a given mains, clamped to what a machine can hold. */
export function crossesFor(mains: number): number {
  return Math.min(TENSION_MAX_LB, Math.max(TENSION_MIN_LB, mains + CROSS_OFFSET_LB));
}

/**
 * Is this pair the conventional one?
 *
 * Used to tell a custom request apart from a simple one after the fact, and to
 * decide whether a hint is worth showing. Deliberately not enforced: a player
 * who wants 28/28 is allowed to have it, and refusing would be the app
 * overruling somebody about their own racket.
 */
export function isConventionalPair(mains: number, crosses: number): boolean {
  return crosses === crossesFor(mains);
}
