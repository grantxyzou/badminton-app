/**
 * THE 14-DAY CLEANUP (docs/plans/one-way-in.md, step 6; Grant: yes to it).
 *
 * Since step 4 an account is made BEFORE anyone lets it in: through a club's
 * link it is made in no club and asks, and inside Create a club it waits for
 * the club to be made. A stranger who is never let in, or someone who gave up
 * half-way through making a club, leaves an account that can see nothing but
 * the no-club screen. This deletes those, 14 days after they were made, with
 * the same `purgeMember` the person's own "Delete my account" uses.
 *
 * WHO. An account carrying `noClubSince` (every account made since step 6;
 * none before, so nobody older is ever touched) that is:
 *   - 14 days past its mark,
 *   - on no club's roster in any status (a removed member once got in, and is
 *     not a stranger), and
 *   - asking nowhere (an organiser's ask list keeps an ask 14 days from the
 *     LAST time it was made, so a person who asked again is still waiting).
 * An account an organiser LINKED to an imported name (step 4b) is retired
 * (`mergedInto`): its sign-ins moved, and it goes at 14 days like the rest.
 *
 * An account found in a club has its mark taken off, once, so the set this
 * reads shrinks back to the people actually waiting.
 *
 * Bounded (`MAX_PURGES_PER_RUN`) because it rides the hourly tick: a backlog
 * clears over a few hours instead of one long request. Counts only come back,
 * never a name.
 */
import { getContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { listMembershipsForMember } from '@/lib/groups';
import { accountAsks } from '@/lib/joinRequests';
import { anonymizeFeedback, purgeMember, purgeNamesFor } from '@/lib/memberPurge';
import type { Member } from '@/lib/types';

export const STRAY_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_PURGES_PER_RUN = 25;

export interface StraySweep {
  /** Marked accounts past their 14 days that were looked at. */
  checked: number;
  /** Deleted: in no club and asking nowhere. */
  purged: number;
  /** Past 14 days but still asking somewhere: kept. */
  waiting: number;
  /** In a club after all: the mark taken off. */
  cleared: number;
}

type Marked = Member & { _etag?: string };

/** Is this account, as it stands now, one to delete? Re-read before acting. */
async function stillStray(memberId: string, now: number): Promise<'stray' | 'in_club' | 'waiting' | 'gone'> {
  const { resource } = await getContainer('members').item(memberId, memberId).read<Marked>();
  if (!resource || typeof resource.noClubSince !== 'string') return 'gone';
  if ((await listMembershipsForMember(memberId)).length > 0) return 'in_club';
  if (!resource.mergedInto && (await accountAsks(resource, now)).some((a) => a.state === 'waiting')) return 'waiting';
  return 'stray';
}

async function clearMark(memberId: string): Promise<void> {
  const container = getContainer('members');
  const { resource } = await container.item(memberId, memberId).read<Marked>();
  if (!resource || resource.noClubSince === undefined) return;
  const { noClubSince: _mark, ...rest } = resource;
  try {
    await container.item(memberId, memberId).replace(rest, resource._etag ? { accessCondition: { type: 'IfMatch', condition: resource._etag } } : undefined);
  } catch (err) {
    // Changed under us: the next hour clears it.
    if ((err as { code?: number })?.code !== 412) throw err;
  }
}

/**
 * What `DELETE /api/members/me` does, minus the session seats: an account in
 * no club holds none, and has played no games. A problem report it filed is
 * anonymized; everything that is its own goes; the Member doc goes last.
 */
async function deleteStray(memberId: string, name: string): Promise<void> {
  const names = await purgeNamesFor(memberId, name);
  await anonymizeFeedback(names, memberId);
  const summary = await purgeMember(memberId, names);
  if (summary.failed.length > 0) {
    console.error(`[stray-accounts] ${memberId} deleted with orphaned rows in: ${summary.failed.join(', ')}`);
  }
  try {
    await getContainer('members').item(memberId, memberId).delete();
  } catch (err) {
    if ((err as { code?: number })?.code !== 404) throw err;
  }
}

export async function sweepStrayAccounts(now = Date.now()): Promise<StraySweep> {
  const out: StraySweep = { checked: 0, purged: 0, waiting: 0, cleared: 0 };
  // With groups off nobody is made in no club, and nothing here can be read.
  if (!isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) return out;

  const { resources } = await getContainer('members')
    .items.query<Pick<Member, 'id' | 'name' | 'noClubSince'>>({
      query: 'SELECT c.id, c.name, c.noClubSince FROM c WHERE IS_DEFINED(c.noClubSince)',
    })
    .fetchAll();
  // Re-checked in JS: the mock store applies no WHERE and no projection.
  const due = (resources ?? []).filter(
    (m) => m && typeof m.noClubSince === 'string' && now - Date.parse(m.noClubSince) >= STRAY_AFTER_MS,
  );

  for (const m of due) {
    if (out.purged >= MAX_PURGES_PER_RUN) break;
    out.checked += 1;
    const verdict = await stillStray(m.id, now);
    if (verdict === 'in_club') {
      await clearMark(m.id);
      out.cleared += 1;
    } else if (verdict === 'waiting') {
      out.waiting += 1;
    } else if (verdict === 'stray') {
      await deleteStray(m.id, m.name ?? '');
      out.purged += 1;
    }
  }
  return out;
}
