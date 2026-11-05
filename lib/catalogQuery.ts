import { getContainer } from './cosmos';
import type { CatalogItem } from './types';

/**
 * One category of the equipment catalog, read from ITS partition.
 *
 * `equipmentCatalog` is keyed by `/category`, and every reader asks for one
 * category — but the query never said which partition, so Cosmos fanned each
 * one out to every partition and merged (audit, 2026-11-05). This is the one
 * place the hint is written: its WHERE is a fixed equality on the key and the
 * hint is that same value, so it cannot drift from the filter, and
 * `__tests__/group-scope-pk-hint.test.ts` exempts this file the way it exempts
 * the scoped accessor. Re-checked in JS because the mock store ignores both
 * the WHERE and the option.
 */
export async function catalogByCategory<T extends { category?: unknown } = CatalogItem>(category: string): Promise<T[]> {
  const { resources } = await getContainer('equipmentCatalog')
    .items.query<T>(
      { query: 'SELECT * FROM c WHERE c.category = @category', parameters: [{ name: '@category', value: category }] },
      { partitionKey: category },
    )
    .fetchAll();
  return (resources ?? []).filter((r) => r && r.category === category);
}
