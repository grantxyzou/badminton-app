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
import { classifyOwed, expandAliasNames, matchesIdentity, type ResolvedIdentity } from './playerIdentity';
import { loadOwedInputs } from './owedRows';
import { isFlagOn } from './flags';
import { rosterMembers } from './roster';
import { stringingCharges, type StringingCharge } from './stringingBilling';
import type { Alias, Player, Session, StringingJob } from './types';

export interface UnpaidSession {
  sessionId: string;
  /** The `players` row that carries this debt — what a payment marks paid. */
  playerId: string;
  date: string;
  owedAmount: number;
  /** The bill is frozen (settled) — only these count toward the soft hold. */
  settled: boolean;
  /** The member tapped "I've sent it" for this line. */
  selfReported: boolean;
  /** ISO — when the bill was frozen on this row; the reminder clock starts here. */
  settledAt: string | null;
  /** Reminders already sent for this row. */
  remindedCount: number;
  /** ISO — when the latest of them went out, or null. */
  lastRemindedAt: string | null;
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

/**
 * The session lines one person owes, from rows already in hand. Pure: the
 * per-person path and the roster-wide path both end here, so the two cannot
 * classify a row differently.
 */
export function unpaidSessionsFrom(
  players: Player[],
  sessionById: Map<string, Session>,
  activeCountBySession: Map<string, number>,
  ctx: { activeSessionId: string; now: number },
): UnpaidSession[] {
  const sessions: UnpaidSession[] = [];
  for (const p of players) {
    const session = sessionById.get(p.sessionId);
    if (!session) continue;
    const result = classifyOwed(p, session, {
      activeSessionId: ctx.activeSessionId,
      now: ctx.now,
      activeCount: activeCountBySession.get(p.sessionId) ?? 0,
    });
    if (result.counted) {
      sessions.push({
        sessionId: p.sessionId,
        playerId: p.id,
        date: session.datetime,
        owedAmount: result.owedAmount,
        settled: !!session.settled,
        selfReported: p.selfReportedPaid === true,
        settledAt: typeof p.settledAt === 'string' ? p.settledAt : null,
        remindedCount: Array.isArray(p.remindedAt) ? p.remindedAt.length : 0,
        lastRemindedAt: Array.isArray(p.remindedAt) && p.remindedAt.length > 0 ? p.remindedAt[p.remindedAt.length - 1] : null,
      });
    }
  }
  return sessions.sort((a, b) => (a.date < b.date ? 1 : -1));
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
  const sessions = unpaidSessionsFrom(players, sessionById, activeCountBySession, { activeSessionId: activeSessionId ?? '', now });
  return { sessions, stringing: await chargesFor(scope, identity.memberId) };
}

export interface RosterOwed {
  memberId: string;
  /** The roster name — what the group calls them. */
  name: string;
  balance: OwedBalance;
}

/**
 * What EVERYONE on the roster owes, in one pass — the reconcile (Phase 2
 * stage 2) and the money view's "still owed" both need the whole club, and
 * running the per-person path 70 times is 70 × 4 reads to answer a question
 * four reads can. This is the whole-history read `lib/owedRows.ts` moved the
 * per-person path AWAY from, and that is fine here: this runs once a day
 * from the script, or on an admin's tap, never on first paint.
 *
 * Same classification as `computeOwed` (`unpaidSessionsFrom`, `stringingCharges`),
 * same identity rule (`matchesIdentity`: memberId, else a name or alias), so
 * a member's line here IS the line Home shows them.
 */
export async function computeOwedForRoster(scope: GroupScope, now: number = Date.now()): Promise<RosterOwed[]> {
  const activeSessionId = (await getActiveSessionId(scope.groupId)) ?? '';
  const roster = await rosterMembers(scope.groupId);
  const aliasRows = await scope.query<Alias>('aliases');
  const allPlayers = (await scope.query<Player>('players')).filter((p) => p && typeof p.id === 'string');
  const sessionById = new Map<string, Session>();
  for (const s of await scope.query<Session>('sessions')) if (s && typeof s.id === 'string') sessionById.set(s.id, s);

  const activeCountBySession = new Map<string, number>();
  for (const p of allPlayers) {
    const s = sessionById.get(p.sessionId);
    if (!s || s.settled || p.removed === true || p.waitlisted === true) continue;
    activeCountBySession.set(p.sessionId, (activeCountBySession.get(p.sessionId) ?? 0) + 1);
  }

  const jobsByMember = new Map<string, StringingJob[]>();
  if (isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    for (const j of await scope.query<StringingJob>('stringingJobs')) {
      if (!j || typeof j.memberId !== 'string') continue;
      jobsByMember.set(j.memberId, [...(jobsByMember.get(j.memberId) ?? []), j]);
    }
  }

  const out: RosterOwed[] = [];
  for (const { member } of roster) {
    const identity = { memberId: member.id, names: expandAliasNames(member.name, aliasRows) };
    const mine = allPlayers.filter((p) => matchesIdentity(p, identity));
    out.push({
      memberId: member.id,
      name: member.name,
      balance: {
        sessions: unpaidSessionsFrom(mine, sessionById, activeCountBySession, { activeSessionId, now }),
        stringing: stringingCharges(jobsByMember.get(member.id) ?? []),
      },
    });
  }
  return out;
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
