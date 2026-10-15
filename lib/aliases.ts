/**
 * E-TRANSFER ALIASES — a club's map from a sign-up name to the legal name a
 * bank shows (security rule 10: payment data, admin-only).
 *
 * An alias is a `kind: 'alias'` row in `clubSettings` (PK `/id`, GROUP
 * scoped), beside the shop sign, the offered strings, the gift cards and the
 * string purchases — NOT a container of its own since 2026-10-14
 * (`docs/plans/container-fold.md`). `aliases` was the one container in the
 * account running on its own dedicated throughput, so it alone doubled the
 * Cosmos bill, for fourteen rows. The copy ran on 2026-10-15 and the old
 * container is deleted.
 *
 * The kind filter is a LITERAL, like `readStringPurchases`: the mock store
 * filters by parameter NAME and knows no `@kind`, so a parameter would read
 * as "no filter" in tests. Every reader re-checks the kind in JS for the same
 * reason — and so the alias route cannot PATCH a gift card by id.
 */
import { randomBytes } from 'crypto';
import type { GroupScope } from './groupScope';
import { ensureClubSettings } from './stringingShop';
import type { Alias } from './types';

export const ALIAS_KIND = 'alias';
const HOME = 'clubSettings' as const;

function isAlias(row: unknown): row is Alias {
  const r = row as Partial<Alias> | null;
  return !!r && r.kind === ALIAS_KIND && typeof r.id === 'string' && typeof r.appName === 'string' && typeof r.etransferName === 'string';
}

/** Every alias of the group, by app name. */
export async function readAliases(scope: GroupScope): Promise<Alias[]> {
  await ensureClubSettings();
  const rows = (await scope.query<Alias>(HOME, { where: `c.kind = '${ALIAS_KIND}'` })).filter(isAlias);
  return rows.sort((a, b) => a.appName.localeCompare(b.appName));
}

/** One alias by id. A doc of another kind at that id reads as absent. */
export async function readAlias(scope: GroupScope, id: string): Promise<Alias | undefined> {
  await ensureClubSettings();
  const row = await scope.read<Alias>(HOME, id);
  return isAlias(row) ? row : undefined;
}

export async function createAlias(
  scope: GroupScope,
  input: { appName: string; etransferName: string; memberId?: string },
): Promise<Alias> {
  await ensureClubSettings();
  return scope.create<Alias>(HOME, {
    id: `alias-${randomBytes(12).toString('hex')}`,
    kind: ALIAS_KIND,
    appName: input.appName,
    etransferName: input.etransferName,
    // So deleting the member's account deletes the link to their legal name.
    ...(input.memberId ? { memberId: input.memberId } : {}),
  });
}

/** Replace an alias. `undefined` when it is gone or is not an alias. */
export async function updateAlias(scope: GroupScope, next: Alias): Promise<Alias | undefined> {
  await ensureClubSettings();
  const existing = await scope.read<Alias>(HOME, next.id);
  if (!isAlias(existing)) return undefined;
  return scope.replace<Alias>(HOME, { ...existing, ...next, kind: ALIAS_KIND });
}

/** Delete an alias. `false` when it is gone or is not an alias. */
export async function removeAlias(scope: GroupScope, id: string): Promise<boolean> {
  await ensureClubSettings();
  // Verify the kind before removing: `remove` checks the group, not what the
  // doc is, and a gift card shares the container.
  const existing = await scope.read<Alias>(HOME, id);
  if (!isAlias(existing)) return false;
  return scope.remove(HOME, id);
}
