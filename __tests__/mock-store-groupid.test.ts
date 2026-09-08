import { describe, it, expect, beforeEach } from 'vitest';
import { getContainer } from '@/lib/cosmos';
import { BPM_GROUP_ID, TOLERATE_UNSTAMPED } from '@/lib/groupScope';
import { resetMockStore, getStore } from './helpers';

/**
 * The mock store filters by PARAMETER NAME from a closed allowlist, and an
 * unrecognised name means NO filter — every row comes back. Until the mock
 * knows `@groupId`, an isolation test written against it passes vacuously:
 * the query "returns only group A's rows" because it returns everything and
 * the fixture only holds group A. This file exists so that cannot happen.
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

  async function ids(groupId: string): Promise<string[]> {
    const { resources } = await getContainer('sessions')
      .items.query<{ id: string }>({
        query: 'SELECT * FROM c WHERE c.groupId = @groupId',
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

  it('treats an unstamped row per the shared TOLERATE_UNSTAMPED constant', async () => {
    // Tolerant: the legacy row is BPM's. Strict: it is nobody's.
    expect(await ids(BPM_GROUP_ID)).toEqual(
      TOLERATE_UNSTAMPED ? ['s-bpm', 's-legacy'] : ['s-bpm'],
    );
  });

  it('ANDs @groupId with the other recognised filters', async () => {
    const { resources } = await getContainer('sessions')
      .items.query<{ id: string }>({
        query: 'SELECT * FROM c WHERE c.groupId = @groupId AND c.sessionId = @sessionId',
        parameters: [
          { name: '@groupId', value: BPM_GROUP_ID },
          { name: '@sessionId', value: 's-legacy' },
        ],
      })
      .fetchAll();
    expect(resources.map((r) => r.id)).toEqual(TOLERATE_UNSTAMPED ? ['s-legacy'] : []);
  });
});
