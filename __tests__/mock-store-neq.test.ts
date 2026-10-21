import { describe, it, expect, beforeEach } from 'vitest';
import { getContainer } from '@/lib/cosmos';
import { resetMockStore, getStore } from './helpers';

/**
 * The mock store filters by PARAMETER NAME, not SQL, so `@id` used to mean
 * "id equals" whatever operator the query carried. The rename-collision check
 * in `PATCH /api/members` asks `… AND c.id != @id` — "does anyone ELSE hold
 * this name?" — and the mock answered with the member itself and nobody else,
 * so the 409 that query exists for could never fire in a test.
 *
 * Like the `@groupId` tolerance (mock-store-groupid.test.ts), the operator is
 * read off the QUERY TEXT: `c.id != @id` / `c.id <> @id` exclude the row, a
 * plain `c.id = @id` still selects only it.
 */
describe('mock store honours the operator on @id', () => {
  beforeEach(() => {
    resetMockStore();
    getStore().members = [
      { id: 'm-a', name: 'Lin', active: true },
      { id: 'm-b', name: 'lin', active: true },
      { id: 'm-c', name: 'Viktor', active: true },
    ];
  });

  async function ids(where: string, params: { name: string; value: string }[]): Promise<string[]> {
    const { resources } = await getContainer('members')
      .items.query<{ id: string }>({ query: `SELECT c.id FROM c WHERE ${where}`, parameters: params })
      .fetchAll();
    return resources.map((r) => r.id).sort();
  }

  it('a plain `c.id = @id` returns only that row', async () => {
    expect(await ids('c.id = @id', [{ name: '@id', value: 'm-a' }])).toEqual(['m-a']);
  });

  it('`c.id != @id` excludes that row and returns the others', async () => {
    expect(await ids('c.id != @id', [{ name: '@id', value: 'm-a' }])).toEqual(['m-b', 'm-c']);
  });

  it('`c.id <> @id` is the same inequality', async () => {
    expect(await ids('c.id <> @id', [{ name: '@id', value: 'm-a' }])).toEqual(['m-b', 'm-c']);
  });

  it("the rename-collision shape finds the OTHER holder of a name, not the member itself", async () => {
    // The exact query `PATCH /api/members` runs with groups off.
    const where = 'LOWER(c.name) = LOWER(@name) AND c.id != @id';
    expect(await ids(where, [{ name: '@name', value: 'Lin' }, { name: '@id', value: 'm-a' }])).toEqual(['m-b']);
    // Nobody else holds it → empty, which is what lets a rename through.
    expect(await ids(where, [{ name: '@name', value: 'Viktor' }, { name: '@id', value: 'm-c' }])).toEqual([]);
  });
});
