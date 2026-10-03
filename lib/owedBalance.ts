/**
 * WHAT ONE PERSON OWES — the single answer behind the Home balance card
 * (`GET /api/players/unpaid`) and the e-transfer matcher (`lib/paymentsInbox.ts`).
 *
 * Extracted so the two cannot disagree. A player pays the total Home shows
 * them; if the matcher computed "owed" any other way, a correct payment would
 * look like an over- or under-payment and go to a human for no reason. Home
 * shows sessions AND finished stringing jobs, so both are here.
 */
import { getActiveSessionId } from './cosmos';
import type { GroupScope } from './groupScope';
import { classifyOwed, type ResolvedIdentity } from './playerIdentity';
import { loadOwedInputs } from './owedRows';
import { isFlagOn } from './flags';
import { stringingCharges, type StringingCharge } from './stringingBilling';
import type { StringingJob } from './types';

export interface UnpaidSession {
  sessionId: string;
  /** The `players` row that carries this debt — what a payment marks paid. */
  playerId: string;
  date: string;
  owedAmount: number;
}

/** One payable line, in cents, for matching an amount against. */
export interface OwedLine {
  kind: 'session' | 'stringing';
  /** `players` row id for a session, job id for stringing. */
  ref: string;
  /** Partition key of the row: the sessionId, or the job's memberId. */
  pk: string;
  amountCents: number;
  /** ISO — orders lines oldest first. */
  at: string;
}

export interface OwedBalance {
  /** Newest first, as the receipt reads. */
  sessions: UnpaidSession[];
  stringing: StringingCharge[];
}

/**
 * Stringing charges for this member, or [] when there are none to add.
 *
 * Deliberately swallows its own failure. The balance card's PRIMARY job is
 * session money, and a stringing container that does not exist yet — or a
 * throw while reading it — must not take the whole balance down with it.
 */
async function chargesFor(scope: GroupScope, memberId: string | null): Promise<StringingCharge[]> {
  if (!memberId || !isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return [];
  try {
    const resources = await scope.query<StringingJob>('stringingJobs', {
      where: 'c.memberId = @memberId',
      params: [{ name: '@memberId', value: memberId }],
    });
    return stringingCharges(resources.filter((j) => j.memberId === memberId));
  } catch {
    return [];
  }
}

export async function computeOwed(
  scope: GroupScope,
  identity: Pick<ResolvedIdentity, 'memberId' | 'names'>,
): Promise<OwedBalance> {
  // Only an EXCLUSION comparand here (the active session is not yet a debt);
  // a group with no session excludes nothing, which is right.
  const activeSessionId = await getActiveSessionId(scope.groupId);
  const now = Date.now();

  // PLAYER-FIRST (lib/owedRows.ts): this person's rows, then only the
  // sessions they name, then the roster of only the unsettled ones.
  const { players, sessionById, activeCountBySession } = await loadOwedInputs(scope, identity);

  const sessions: UnpaidSession[] = [];
  for (const p of players) {
    const session = sessionById.get(p.sessionId);
    if (!session) continue;
    const result = classifyOwed(p, session, {
      activeSessionId: activeSessionId ?? '',
      now,
      activeCount: activeCountBySession.get(p.sessionId) ?? 0,
    });
    if (result.counted) {
      sessions.push({ sessionId: p.sessionId, playerId: p.id, date: session.datetime, owedAmount: result.owedAmount });
    }
  }
  sessions.sort((a, b) => (a.date < b.date ? 1 : -1));

  return { sessions, stringing: await chargesFor(scope, identity.memberId) };
}

/** The balance as payable lines, OLDEST first — the order a payment settles them in. */
export function owedLines(balance: OwedBalance, memberId: string | null): OwedLine[] {
  const lines: OwedLine[] = [
    ...balance.sessions.map((s) => ({
      kind: 'session' as const,
      ref: s.playerId,
      pk: s.sessionId,
      amountCents: Math.round(s.owedAmount * 100),
      at: s.date,
    })),
    ...(memberId
      ? balance.stringing.map((c) => ({
          kind: 'stringing' as const,
          ref: c.jobId,
          pk: memberId,
          amountCents: Math.round(c.amount * 100),
          at: c.at,
        }))
      : []),
  ];
  return lines.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
