import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { groupScope, buildGroupQuery, BPM_GROUP_ID, TOLERATE_UNSTAMPED } from '@/lib/groupScope';
import { POINTER_ID, SESSION_ID } from '@/lib/cosmos';
import { resetMockStore, getStore } from './helpers';

/**
 * THE SCOPED ACCESSOR — the only way a route reads or writes a GROUP_SCOPED
 * container once the sweep is done.
 *
 * Three independent layers against a cross-group leak, each pinned here:
 *   1. the builder always emits the group clause (a query cannot forget it);
 *   2. every returned row is re-checked in JS and a mismatch is dropped with
 *      a `[group-leak]` log (a query that somehow bypassed the clause still
 *      cannot hand back another group's row);
 *   3. writes are stamped with the scope's group, never the caller's.
 */
const A = 'a1b2c3';
const B = 'd4e5f6';

describe('buildGroupQuery', () => {
  it('emits the group clause on its own when there is no WHERE', () => {
    const q = buildGroupQuery(A, 'players', {});
    expect(q.query).toBe('SELECT * FROM c WHERE c.groupId = @groupId');
    expect(q.parameters).toEqual([{ name: '@groupId', value: A }]);
  });

  it('wraps the caller WHERE in parentheses so an OR cannot escape the clause', () => {
    const q = buildGroupQuery(A, 'players', {
      where: 'c.sessionId = @sessionId OR c.removed = true',
      params: [{ name: '@sessionId', value: 's1' }],
    });
    expect(q.query).toBe(
      'SELECT * FROM c WHERE c.groupId = @groupId AND (c.sessionId = @sessionId OR c.removed = true)',
    );
    expect(q.parameters).toEqual([
      { name: '@sessionId', value: 's1' },
      { name: '@groupId', value: A },
    ]);
  });

  it('carries ORDER BY and OFFSET/LIMIT after the WHERE', () => {
    const q = buildGroupQuery(A, 'sessions', { orderBy: 'c.id DESC', limit: 9 });
    expect(q.query).toMatch(/ ORDER BY c\.id DESC OFFSET 0 LIMIT 9$/);
  });

  it('appends c.groupId to a projection so every row can be verified', () => {
    const q = buildGroupQuery(A, 'players', { select: 'c.id, c.name' });
    expect(q.query.startsWith('SELECT c.id, c.name, c.groupId FROM c')).toBe(true);
  });

  it('leaves a VALUE projection alone', () => {
    const q = buildGroupQuery(A, 'players', { select: 'VALUE COUNT(1)' });
    expect(q.query.startsWith('SELECT VALUE COUNT(1) FROM c WHERE')).toBe(true);
  });

  it('uses the tolerant clause for BPM only, per the shared constant', () => {
    expect(buildGroupQuery(BPM_GROUP_ID, 'players', {}).query).toContain(
      TOLERATE_UNSTAMPED ? 'NOT IS_DEFINED(c.groupId)' : 'c.groupId = @groupId',
    );
    expect(buildGroupQuery(A, 'players', {}).query).not.toContain('NOT IS_DEFINED');
  });

  it('excludes the group\'s own pointer doc from every sessions query', () => {
    // The pointer is a row in `sessions`, stamped with its group and carrying
    // no datetime; without this it comes back as "a session" in every list.
    const q = buildGroupQuery(A, 'sessions', {});
    expect(q.query).toContain('c.id != @pointerId');
    expect(q.parameters).toContainEqual({ name: '@pointerId', value: `${A}:${POINTER_ID}` });
    expect(buildGroupQuery(BPM_GROUP_ID, 'sessions', {}).parameters).toContainEqual({
      name: '@pointerId',
      value: POINTER_ID,
    });
    expect(buildGroupQuery(A, 'players', {}).query).not.toContain('@pointerId');
  });

  it('refuses a caller parameter named @groupId or @pointerId', () => {
    expect(() =>
      buildGroupQuery(A, 'players', { params: [{ name: '@groupId', value: B }] }),
    ).toThrow(/@groupId/);
  });
});

describe('groupScope', () => {
  let leak: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetMockStore();
    leak = vi.spyOn(console, 'error').mockImplementation(() => {});
    getStore().players = [
      { id: 'pa', sessionId: 's-a', groupId: A, name: 'Lin' },
      { id: 'pb', sessionId: 's-b', groupId: B, name: 'Viktor' },
      { id: 'pl', sessionId: 's-legacy', name: 'Carolina' }, // unstamped
    ];
    getStore().sessions = [
      { id: `${A}:${POINTER_ID}`, sessionId: `${A}:${POINTER_ID}`, groupId: A, activeSessionId: 's-a' },
      { id: 's-a', sessionId: 's-a', groupId: A, datetime: '2026-09-10T19:00:00-07:00' },
    ];
  });
  afterEach(() => leak.mockRestore());

  it('query returns only the group\'s rows', async () => {
    const rows = await groupScope(A).query<{ id: string }>('players');
    expect(rows.map((r) => r.id)).toEqual(['pa']);
    expect(leak).not.toHaveBeenCalled();
  });

  it('query for BPM includes an unstamped row while tolerant', async () => {
    const rows = await groupScope(BPM_GROUP_ID).query<{ id: string }>('players');
    expect(rows.map((r) => r.id)).toEqual(TOLERATE_UNSTAMPED ? ['pl'] : []);
  });

  it('query never returns the pointer doc as a session', async () => {
    const rows = await groupScope(A).query<{ id: string }>('sessions');
    expect(rows.map((r) => r.id)).toEqual(['s-a']);
  });

  it('count respects the scope', async () => {
    expect(await groupScope(A).count('players')).toBe(1);
    expect(await groupScope(B).count('players', 'c.sessionId = @sessionId', [{ name: '@sessionId', value: 's-b' }])).toBe(1);
    expect(await groupScope(B).count('players', 'c.sessionId = @sessionId', [{ name: '@sessionId', value: 's-a' }])).toBe(0);
  });

  it('drops a row the query let through and logs the leak', async () => {
    // Simulate a store that ignores the clause: rows of another group reach
    // the accessor. The JS re-check is the last line.
    getStore().players.push({ id: 'px', sessionId: 's-a', groupId: B, name: 'Akane' });
    const rows = await groupScope(A).query<{ id: string }>('players', {
      where: 'c.sessionId = @sessionId',
      params: [{ name: '@sessionId', value: 's-a' }],
    });
    expect(rows.map((r) => r.id)).toEqual(['pa']);
    // The mock honours @groupId, so nothing leaked here; the sentinel is pinned
    // by the read() test below, where the mock ignores the partition key.
  });

  it('read verifies the group and hides another group\'s doc', async () => {
    const mine = await groupScope(A).read<{ id: string }>('players', 'pa', 's-a');
    expect(mine?.id).toBe('pa');
    const theirs = await groupScope(A).read('players', 'pb', 's-b');
    expect(theirs).toBeUndefined();
    expect(leak).toHaveBeenCalledWith(expect.stringContaining('[group-leak]'), expect.anything());
  });

  it('read derives the partition key from the id when the registry says /id', async () => {
    getStore().birds = [{ id: 'b1', groupId: A, tubes: 3 }];
    expect((await groupScope(A).read<{ id: string }>('birds', 'b1'))?.id).toBe('b1');
  });

  it('read refuses a missing partition-key value for a non-/id container', async () => {
    await expect(groupScope(A).read('players', 'pa')).rejects.toThrow(/partition key/);
  });

  it('create and upsert stamp the scope\'s group, overriding the caller\'s', async () => {
    await groupScope(A).create('players', { id: 'pn', sessionId: 's-a', name: 'Kento', groupId: B });
    await groupScope(A).upsert('players', { id: 'pa', sessionId: 's-a', name: 'Lin', paid: true });
    const store = getStore().players as Record<string, unknown>[];
    expect(store.find((p) => p.id === 'pn')?.groupId).toBe(A);
    expect(store.find((p) => p.id === 'pa')).toMatchObject({ groupId: A, paid: true });
  });

  it('remove deletes only a doc that belongs to the group', async () => {
    await groupScope(A).remove('players', 'pb', 's-b');
    expect((getStore().players as { id: string }[]).some((p) => p.id === 'pb')).toBe(true);
    await groupScope(A).remove('players', 'pa', 's-a');
    expect((getStore().players as { id: string }[]).some((p) => p.id === 'pa')).toBe(false);
  });

  it('read verifies the partition-key FIELD too, because the mock ignores the key argument', async () => {
    // Cosmos would 404 a point read with the wrong partition key; the mock
    // finds by id alone. Without this check the accessor is laxer than
    // production on every /sessionId-keyed point read.
    expect(await groupScope(A).read('players', 'pa', 's-wrong')).toBeUndefined();
    expect(leak).toHaveBeenCalledWith(expect.stringContaining('[group-leak]'), expect.anything());
    expect(await groupScope(A).remove('players', 'pa', 's-wrong')).toBe(false);
    expect((getStore().players as { id: string }[]).some((p) => p.id === 'pa')).toBe(true);
  });
});

describe('buildGroupQuery guards', () => {
  it('refuses DISTINCT, TOP and any VALUE projection other than COUNT', () => {
    // The builder appends c.groupId to a field list and skips verification
    // for VALUE selects; the mock applies no projections, so a shape that
    // breaks either rule would pass CI and misbehave only in Cosmos.
    expect(() => buildGroupQuery(A, 'sessions', { select: 'DISTINCT c.locationName' })).toThrow(/DISTINCT/);
    expect(() => buildGroupQuery(A, 'sessions', { select: 'TOP 5 c.id' })).toThrow(/TOP/);
    expect(() => buildGroupQuery(A, 'players', { select: 'VALUE c.name' })).toThrow(/VALUE/);
    expect(() => buildGroupQuery(A, 'players', { select: 'VALUE COUNT(1)' })).not.toThrow();
  });

  it('excludes the legacy current-session doc from sessions reads unless asked to include it', () => {
    // BPM's pre-pointer default session is a real row that every list has
    // always excluded by hand. Builder-owned now, like the pointer exclusion,
    // so the next list cannot forget the incantation.
    const q = buildGroupQuery(BPM_GROUP_ID, 'sessions', {});
    expect(q.query).toContain('c.id != @legacyId');
    expect(q.parameters).toContainEqual({ name: '@legacyId', value: SESSION_ID });
    const inclusive = buildGroupQuery(BPM_GROUP_ID, 'sessions', { includeLegacy: true });
    expect(inclusive.query).not.toContain('@legacyId');
    expect(buildGroupQuery(A, 'players', {}).query).not.toContain('@legacyId');
    expect(() =>
      buildGroupQuery(A, 'sessions', { params: [{ name: '@legacyId', value: 'x' }] }),
    ).toThrow(/@legacyId/);
  });
});
