import { getContainer } from './cosmos';
import type { Alias, Member, Player, Session } from './types';
import { sessionCostTotals } from './sessionCost';

/**
 * Shared player-identity resolution + owed classification.
 *
 * The friend-group app keys a lot of cross-session math on a player's *name*,
 * but the same human can appear under more than one row identity across weeks:
 *   - a persistent `memberId` link (the durable identity), and/or
 *   - a renamed member (old player rows keep the old name but the memberId), and/or
 *   - admin-curated `aliases` mapping an app signup name ↔ an e-transfer name.
 *
 * Matching by raw name only (as `/api/players/unpaid` used to) silently drops
 * any week signed up under a variant. This module is the ONE place that resolves
 * "who is this" (`resolveIdentity` + `matchesIdentity`) and "does this session
 * count toward what they owe, and if not why" (`classifyOwed`) so the player
 * card, the admin ledger drill-in, and the admin owed-audit can never disagree.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** True when `s.datetime` parses to a finite timestamp. Mirrors the admin
 *  ledger's guard so a malformed/absent datetime drops the session instead of
 *  poisoning the math with NaN. */
export function finiteSessionDate(s: Pick<Session, 'datetime'>): boolean {
  return typeof s.datetime === 'string' && Number.isFinite(new Date(s.datetime).getTime());
}

/**
 * Given a name and the full alias list, return the set of lowercased candidate
 * names that refer to the same person. Bidirectional: a match on either side of
 * an `appName ↔ etransferName` pair contributes the other side. Always includes
 * the input name itself. Pure — the caller supplies the alias rows.
 */
export function expandAliasNames(name: string, aliasRows: Alias[]): Set<string> {
  const lower = name.trim().toLowerCase();
  const names = new Set<string>([lower]);
  for (const a of aliasRows) {
    const app = typeof a.appName === 'string' ? a.appName.toLowerCase() : '';
    const et = typeof a.etransferName === 'string' ? a.etransferName.toLowerCase() : '';
    if (!app || !et) continue;
    if (app === lower) names.add(et);
    if (et === lower) names.add(app);
  }
  return names;
}

export interface ResolvedIdentity {
  member: Member | null;
  memberId: string | null;
  /** Lowercased candidate names (queried/member name + alias-linked names). */
  names: Set<string>;
}

/**
 * Resolve a player's identity from a name (or memberId). Reads the `members`
 * and `aliases` containers. Used by `/api/players/unpaid` and
 * `/api/admin/owed-audit`. Never throws on an empty result — an unknown name
 * resolves to `{ member: null, memberId: null, names: { <name> } }`.
 */
export async function resolveIdentity(arg: { name?: string; memberId?: string }): Promise<ResolvedIdentity> {
  const membersContainer = getContainer('members');
  const aliasesContainer = getContainer('aliases');

  let member: Member | null = null;
  if (arg.memberId) {
    const { resource } = await membersContainer.item(arg.memberId, arg.memberId).read<Member>();
    member = resource ?? null;
  } else if (arg.name) {
    // STRINGEQUALS(..., true) = case-insensitive on real Cosmos; the mock store
    // filters on the `@name` param (also case-insensitive).
    const { resources } = await membersContainer.items
      .query({
        query: 'SELECT * FROM c WHERE STRINGEQUALS(c.name, @name, true)',
        parameters: [{ name: '@name', value: arg.name }],
      })
      .fetchAll();
    member = (resources[0] as Member | undefined) ?? null;
  }

  const baseName = (member?.name ?? arg.name ?? '').trim();
  const { resources: aliasRows } = await aliasesContainer.items
    .query({ query: 'SELECT * FROM c' })
    .fetchAll();
  const names = baseName ? expandAliasNames(baseName, aliasRows as Alias[]) : new Set<string>();

  return { member, memberId: member?.id ?? null, names };
}

/** Does this player row belong to the resolved identity? memberId is the strong
 *  signal; name membership covers legacy/alias rows. */
export function matchesIdentity(
  p: Pick<Player, 'name' | 'memberId'>,
  idy: Pick<ResolvedIdentity, 'memberId' | 'names'>,
): boolean {
  if (idy.memberId && p.memberId === idy.memberId) return true;
  return typeof p.name === 'string' && idy.names.has(p.name.toLowerCase());
}

export type OwedReason =
  | 'counted'
  | 'paid'
  | 'written_off'
  | 'removed'
  | 'waitlisted'
  | 'unsettled_no_cost'
  | 'settled_zero_owed'
  | 'bad_datetime'
  | 'future_or_active';

export interface OwedContext {
  activeSessionId: string;
  now: number;
  /** Full active-roster size of the session (the live per-person denominator).
   *  Only consulted for unsettled past sessions. */
  activeCount: number;
}

export interface OwedResult {
  counted: boolean;
  reason: OwedReason;
  owedAmount: number;
}

/**
 * Decide whether one (player, session) pair counts toward what the player owes,
 * and the amount. This is the single source of truth shared by the unpaid card
 * and the admin owed-audit — identical predicates, so the audit always explains
 * exactly what the card shows.
 *
 *  - Settled session → the frozen `owedAmount` (counts only when > 0). A settled
 *    debt counts even on the active session (the bill was already frozen).
 *  - Unsettled past session → the live per-person share `totalCost / activeCount`
 *    (the active session itself and any future session never count this way).
 */
export function classifyOwed(
  player: Pick<Player, 'paid' | 'writtenOff' | 'removed' | 'waitlisted' | 'owedAmount'>,
  session: Pick<Session, 'id' | 'datetime' | 'settled' | 'costPerCourt' | 'courts' | 'birdUsage' | 'birdUsages'>,
  ctx: OwedContext,
): OwedResult {
  const miss = (reason: OwedReason): OwedResult => ({ counted: false, reason, owedAmount: 0 });

  if (!finiteSessionDate(session)) return miss('bad_datetime');
  if (player.paid === true) return miss('paid');
  if (player.writtenOff === true) return miss('written_off');

  if (session.settled) {
    const owed = player.owedAmount ?? 0;
    if (owed > 0) return { counted: true, reason: 'counted', owedAmount: round2(owed) };
    return miss('settled_zero_owed');
  }

  // Unsettled: only PAST, non-active sessions are billable as a live share.
  if (player.removed === true) return miss('removed');
  if (player.waitlisted === true) return miss('waitlisted');
  if (session.id === ctx.activeSessionId) return miss('future_or_active');
  if (new Date(session.datetime).getTime() >= ctx.now) return miss('future_or_active');

  const { totalCost } = sessionCostTotals(session);
  if (totalCost > 0 && ctx.activeCount > 0) {
    return { counted: true, reason: 'counted', owedAmount: round2(totalCost / ctx.activeCount) };
  }
  return miss('unsettled_no_cost');
}
