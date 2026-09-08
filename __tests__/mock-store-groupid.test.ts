import { describe, it, expect, beforeEach } from 'vitest';
import { getContainer } from '@/lib/cosmos';
import { BPM_GROUP_ID, TOLERATE_UNSTAMPED, groupClause } from '@/lib/groupScope';
import { resetMockStore, getStore } from './helpers';

/**
 * The mock store filters by PARAMETER NAME from a closed allowlist, and an
 * unrecognised name means NO filter — every row comes back. Until the mock
 * knows `@groupId`, an isolation test written against it passes vacuously:
 * the query "returns only group A's rows" because it returns everything and
 * the fixture only holds group A. This file exists so that cannot happen.
 *
 * And the mock must mean the SAME thing as Cosmos for BOTH clause shapes. A
 * plain `c.groupId = @groupId` matches no unstamped row in Cosmos, so the mock
 * must not hand legacy rows back for it either — otherwise a query that
 * returns BPM's history in tests returns nothing in production. Tolerance is
 * honoured only when the query text carries the tolerant clause.
 */
describe('mock store honours @groupId', () => {
  beforeEach(() => {
    resetMockStore();
    getStore().sessions = [
      { id: 's-bpm', sessionId: 's-bpm', groupId: BPM_GROUP_ID },
      { id: 's-other', sessionId: 's-other', groupId: 'a1b2c3' },
      { id: 's-legacy', sessionId: 's-legacy' }, // pre-backfill, unstamped
    ];
  });

  async function ids(groupId: string, clause = 'c.groupId = @groupId'): Promise<string[]> {
    const { resources } = await getContainer('sessions')
      .items.query<{ id: string }>({
        query: `SELECT * FROM c WHERE ${clause}`,
        parameters: [{ name: '@groupId', value: groupId }],
      })
      .fetchAll();
    return resources.map((r) => r.id).sort();
  }

  it("returns only the other group's stamped rows for that group", async () => {
    expect(await ids('a1b2c3')).toEqual(['s-other']);
  });

  it('returns nothing for a group with no rows', async () => {
    expect(await ids('nobody')).toEqual([]);
  });

  it('a plain equality clause excludes unstamped rows, as Cosmos would', async () => {
    expect(await ids(BPM_GROUP_ID)).toEqual(['s-bpm']);
  });

  it('the tolerant clause includes unstamped rows for BPM only', async () => {
    expect(await ids(BPM_GROUP_ID, groupClause(true))).toEqual(['s-bpm', 's-legacy']);
    expect(await ids('a1b2c3', groupClause(true))).toEqual(['s-other']);
  });

  it('the strict clause excludes unstamped rows even for BPM', async () => {
    expect(await ids(BPM_GROUP_ID, groupClause(false))).toEqual(['s-bpm']);
  });

  it('groupClause() defaults to the shared TOLERATE_UNSTAMPED constant', async () => {
    expect(await ids(BPM_GROUP_ID, groupClause())).toEqual(
      TOLERATE_UNSTAMPED ? ['s-bpm', 's-legacy'] : ['s-bpm'],
    );
  });

  it('ANDs the group clause with the other recognised filters', async () => {
    const { resources } = await getContainer('sessions')
      .items.query<{ id: string }>({
        query: `SELECT * FROM c WHERE ${groupClause(true)} AND c.sessionId = @sessionId`,
        parameters: [
          { name: '@groupId', value: BPM_GROUP_ID },
          { name: '@sessionId', value: 's-legacy' },
        ],
      })
      .fetchAll();
    expect(resources.map((r) => r.id)).toEqual(['s-legacy']);
  });
});
