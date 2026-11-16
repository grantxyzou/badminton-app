/**
 * WHAT A PERSON STILL OWES, ACROSS EVERY CLUB THEY ARE IN — the gate on
 * deleting an account (docs/plans/money-audit.md, gap 4; Grant, 2026-11-16:
 * "no account deactivation when outstanding balance exists").
 *
 * Deleting an account purges the person's stringing jobs and anonymizes
 * their session rows, so a debt on either became a line the club's books
 * held and nobody could be asked for. The figure here is the one Home shows
 * them (`computeOwed`: frozen lines, finished stringing jobs AND the live
 * estimate for a session they played that is not yet settled — that too
 * becomes a debt the moment it is), club by club, so the refusal can name
 * where the money is owed.
 */
import { isFlagOn } from './flags';
import { BPM_GROUP_ID, groupScope } from './groupScope';
import { listMembershipsForMember, readGroup } from './groups';
import { computeOwed } from './owedBalance';
import { resolveIdentity } from './playerIdentity';

export interface OutstandingBalance {
  cents: number;
  clubs: { groupId: string; name: string; cents: number }[];
}

export async function outstandingBalanceFor(memberId: string): Promise<OutstandingBalance> {
  const groupIds = isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')
    ? (await listMembershipsForMember(memberId)).filter((m) => m.status === 'active').map((m) => m.groupId)
    : [BPM_GROUP_ID];
  const clubs: OutstandingBalance['clubs'] = [];
  for (const groupId of new Set(groupIds)) {
    const identity = await resolveIdentity({ memberId }, groupId);
    const balance = await computeOwed(groupScope(groupId), identity);
    const cents =
      balance.sessions.reduce((sum, s) => sum + Math.round(s.owedAmount * 100), 0) +
      balance.stringing.reduce((sum, c) => sum + Math.round(c.amount * 100), 0);
    if (cents > 0) clubs.push({ groupId, name: (await readGroup(groupId))?.name ?? groupId, cents });
  }
  return { cents: clubs.reduce((sum, c) => sum + c.cents, 0), clubs };
}
