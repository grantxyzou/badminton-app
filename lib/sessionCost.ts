import type { Session } from './types';
import { normalizeBirdUsages, totalBirdCost } from './birdUsages';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Court + bird cost totals for a session — the single source of the "what did
 * this session cost" math. One place so the three callers can never disagree:
 *   - `POST /api/session/settle` freezes these into the `SettledSnapshot`;
 *   - `GET /api/players/unpaid` uses `totalCost` to compute a per-person share
 *     for sessions that were never settled (no frozen `owedAmount`);
 *   - any future cost display.
 *
 * Tolerates the legacy single-object `birdUsage` shape via `normalizeBirdUsages`.
 * Missing court inputs → 0 (you can't owe a share of an unpriced session).
 */
export function sessionCostTotals(
  session:
    | Pick<Session, 'costPerCourt' | 'courts' | 'birdUsage' | 'birdUsages'>
    | null
    | undefined,
): { courtTotal: number; birdTotal: number; totalCost: number } {
  const courtTotal = round2((session?.costPerCourt ?? 0) * (session?.courts ?? 0));
  const birdTotal = totalBirdCost(normalizeBirdUsages(session));
  const totalCost = round2(courtTotal + birdTotal);
  return { courtTotal, birdTotal, totalCost };
}

/** The player fields the split needs — decoupled from the full `Player`. */
export interface SplitPlayer {
  removed?: boolean;
  waitlisted?: boolean;
  writtenOff?: boolean;
  coverMode?: 'absorb' | 'resplit';
}

export interface CostSplit<P extends SplitPlayer> {
  courtTotal: number;
  birdTotal: number;
  totalCost: number;
  /** Not removed, not waitlisted — everyone who played. */
  active: P[];
  /** Who the total was divided by: active minus the resplit-covered. */
  denominator: number;
  /** 0 when there is no cost or nobody to split it across. INCLUDES `organiserFee`. */
  costPerPerson: number;
  /** The organiser's fee inside each share (docs/plans/organiser-fee.md); 0 when none
   *  or when there is nothing to split. `costPerPerson − organiserFee` is the cost share. */
  organiserFee: number;
  /** Σ costPerPerson over absorb-covered players — what the admin eats. */
  coveredTotal: number;
}

/**
 * THE per-person split, cover-aware, for a session that is NOT settled (a
 * settled session's numbers are frozen on `session.settled` and win over any
 * recompute — see `buildReceiptInput`).
 *
 * A covered (`writtenOff`) player either:
 *   - 'resplit' → leaves the denominator, so their share spreads across the
 *     remaining payers (group total unchanged, admin pays $0);
 *   - 'absorb'  → stays in the denominator, so everyone else pays the same
 *     and the admin eats the covered share (`coveredTotal`).
 * Legacy `writtenOff` with no `coverMode` is 'absorb'.
 *
 * This used to be computed in FOUR places and only settle honoured resplit:
 * the receipt builder, the member-history route and the command-center
 * receipt each divided by the active count, so a member's history could
 * show a different amount than their own settled receipt whenever a cover
 * had been resplit. One function now; settle freezes what it returns.
 */
/** A covered player whose share was spread across the others (owes $0). */
export function isResplitCovered(p: SplitPlayer): boolean {
  return p.writtenOff === true && p.coverMode === 'resplit';
}

/** The session's organiser fee per player, or 0 for an absent, negative or malformed one. */
export function organiserFeeOf(session: Pick<Session, 'organiserFee'> | null | undefined): number {
  const fee = session?.organiserFee;
  return typeof fee === 'number' && Number.isFinite(fee) && fee > 0 ? round2(fee) : 0;
}

export function costSplit<P extends SplitPlayer>(
  session: Pick<Session, 'costPerCourt' | 'courts' | 'birdUsage' | 'birdUsages' | 'organiserFee'> | null | undefined,
  players: P[],
): CostSplit<P> {
  const { courtTotal, birdTotal, totalCost } = sessionCostTotals(session);
  const active = players.filter((p) => p.removed !== true && p.waitlisted !== true);
  const resplitCount = active.filter(isResplitCovered).length;
  const absorbCount = active.filter((p) => p.writtenOff === true && !isResplitCovered(p)).length;
  const denominator = active.length - resplitCount;
  const priced = totalCost > 0 && denominator > 0;
  // The organiser's fee rides on top of the cost share, per player who pays —
  // never on an unpriced night, and never re-spread by a resplit cover. An
  // absorb cover forgives it with the rest of the share (coveredTotal).
  const organiserFee = priced ? organiserFeeOf(session) : 0;
  const costPerPerson = priced ? round2(round2(totalCost / denominator) + organiserFee) : 0;
  const coveredTotal = round2(absorbCount * costPerPerson);
  return { courtTotal, birdTotal, totalCost, active, denominator, costPerPerson, organiserFee, coveredTotal };
}
