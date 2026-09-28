import { getContainer, ensureContainer } from './cosmos';
import { isFlagOn } from './flags';
import { rosterMemberIds } from './roster';
import type { PlayerGear } from './types';

/**
 * The club's gear documents, narrowed to the roster, projected to the bag only.
 *
 * `playerGear` is PERSON-scoped (see stats/club/bands), so any aggregate over
 * it counts other clubs' bags unless narrowed. The projection is the privacy
 * boundary for the club readers: the fit answers on the same document are
 * never selected, so no aggregate built from these rows can reach them.
 */
export type ClubGearDoc = Pick<PlayerGear, 'items' | 'activeRacketId'> & { memberId?: string };

export async function readClubGearDocs(groupId: string): Promise<ClubGearDoc[]> {
  await ensureContainer('playerGear', '/memberId');
  const roster = isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP') ? await rosterMemberIds(groupId) : null;
  // Narrowed in SQL as well when there is a roster; the mock ignores
  // `@memberIds`, so the JS filter below is what tests exercise.
  const { resources } = await getContainer('playerGear')
    .items.query(
      roster
        ? {
            query: 'SELECT c.memberId, c.items, c.activeRacketId FROM c WHERE ARRAY_CONTAINS(@memberIds, c.memberId)',
            parameters: [{ name: '@memberIds', value: [...roster] }],
          }
        : { query: 'SELECT c.memberId, c.items, c.activeRacketId FROM c' },
    )
    .fetchAll();
  return (resources as ClubGearDoc[]).filter(
    (r) => !roster || (typeof r.memberId === 'string' && roster.has(r.memberId)),
  );
}
