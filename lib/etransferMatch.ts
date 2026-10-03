/**
 * Which owed lines does a received amount pay? Pure — the I/O is in
 * `lib/paymentsInbox.ts`.
 *
 * NEVER GUESS WITH MONEY. An auto-match marks somebody paid without a person
 * looking, so it happens only when every one of these holds:
 *   - Google verified the email as Interac's (`authenticated`);
 *   - exactly ONE person can be the sender;
 *   - the amount equals one owed line, or the oldest k lines, or the whole
 *     balance (which is the oldest-n case).
 * Everything else — over- and under-payments, two people who could be "Lin",
 * an unknown name — goes to the admin's "Needs a look" queue with whatever
 * was found, so a person decides in one tap instead of re-typing it.
 */
import type { OwedLine } from './owedBalance';

/**
 * The lines a payment of `amountCents` settles, or `null` if no clean set does.
 * `lines` must be oldest first.
 *
 * A single exact line wins over a prefix: someone who owes $12, $15 and $12
 * and sends $15 paid the $15 one. With several equal lines it is the OLDEST —
 * which line two identical amounts settle does not change what is still owed.
 */
export function allocateAmount(lines: readonly OwedLine[], amountCents: number): OwedLine[] | null {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return null;
  const exact = lines.find((l) => l.amountCents === amountCents);
  if (exact) return [exact];
  let sum = 0;
  for (let k = 0; k < lines.length; k++) {
    sum += lines[k].amountCents;
    if (sum === amountCents) return lines.slice(0, k + 1);
    if (sum > amountCents) break;
  }
  return null;
}

export interface MatchCandidate {
  memberId: string | null;
  /** The name the club knows them by. */
  name: string;
  lines: OwedLine[];
}

export type ReviewReason =
  | 'unrecognized_email'
  | 'unauthenticated'
  | 'unknown_sender'
  | 'ambiguous_sender'
  | 'nothing_owed'
  | 'amount_mismatch';

export type MatchDecision =
  | { status: 'matched'; candidate: MatchCandidate; allocations: OwedLine[] }
  | { status: 'review'; reason: ReviewReason; candidates: MatchCandidate[] };

export function decideMatch(input: {
  recognized: boolean;
  authenticated: boolean;
  amountCents: number | null;
  candidates: MatchCandidate[];
}): MatchDecision {
  const { candidates } = input;
  const review = (reason: ReviewReason): MatchDecision => ({ status: 'review', reason, candidates });

  if (!input.recognized || input.amountCents === null) return review('unrecognized_email');
  if (candidates.length === 0) return review('unknown_sender');
  if (candidates.length > 1) return review('ambiguous_sender');
  const [candidate] = candidates;
  if (candidate.lines.length === 0) return review('nothing_owed');
  const allocations = allocateAmount(candidate.lines, input.amountCents);
  if (!allocations) return review('amount_mismatch');
  // Checked LAST so the queue still shows who and which lines it would have
  // been — the admin's tap is then a confirmation, not a search.
  if (!input.authenticated) return review('unauthenticated');
  return { status: 'matched', candidate, allocations };
}
