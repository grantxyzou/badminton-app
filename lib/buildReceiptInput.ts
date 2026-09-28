import type { ETransferRecipient, Session } from './types';
import type { ReceiptInput } from './receiptTemplate';
import { costSplit, type SplitPlayer } from './sessionCost';

export interface ReceiptBuild {
  /** Per-person amount whenever it is computable (snapshot or recompute),
   *  even when no recipient is set — so the list row can still show the cost. */
  costPerPerson: number | null;
  /** The exact object `ReceiptSheet` renders. Null when a receipt can't be built. */
  input: ReceiptInput | null;
  /** Why `input` is null. Absent when `input` is present. */
  error?: string;
}

/** Minimal player shape the resolver needs — decoupled from the full `Player`. */
type RosterPlayer = SplitPlayer & { name: string };

export const NO_COST = 'This session has no recorded cost.';
export const NO_RECIPIENT = 'Set an e-transfer recipient first (admin settings) before sharing.';

/**
 * Single source of truth for "what did this past session cost per person, and
 * what's its receipt". Computes cost-per-person ONCE so a caller that shows the
 * number in a list and a caller that renders the receipt cannot disagree (the
 * three-way divergence risk documented in the spec §2).
 *
 * - Settled → snapshot-first: the frozen, cover-aware `costPerPerson` /
 *   `totalCost` / `playerNames` win over any live recompute.
 * - Unsettled → best-effort recompute via the canonical `costSplit`, which
 *   honours a resplit cover the same way settle will when it freezes.
 */
export function buildReceiptInput(
  session: Session,
  players: RosterPlayer[],
  recipient: ETransferRecipient | null,
): ReceiptBuild {
  let costPerPerson: number;
  let totalCost: number;
  let playerNames: string[];

  if (session.settled) {
    costPerPerson = session.settled.costPerPerson;
    totalCost = session.settled.totalCost;
    playerNames = session.settled.playerNames;
  } else {
    const split = costSplit(session, players);
    if (split.costPerPerson <= 0) {
      return { costPerPerson: null, input: null, error: NO_COST };
    }
    totalCost = split.totalCost;
    costPerPerson = split.costPerPerson;
    playerNames = split.active.map((p) => p.name);
  }

  // Cost is known from here. A receipt additionally needs someone to pay.
  if (!recipient) {
    return { costPerPerson, input: null, error: NO_RECIPIENT };
  }

  return {
    costPerPerson,
    input: {
      datetime: session.datetime,
      costPerPerson,
      courts: session.courts ?? 0,
      totalCost,
      playerNames,
      recipient: { name: recipient.name, email: recipient.email },
      ...(recipient.memo ? { memoTemplate: recipient.memo } : {}),
    },
  };
}
