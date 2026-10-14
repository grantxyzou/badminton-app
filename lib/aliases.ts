/**
 * E-TRANSFER ALIASES — a club's map from a sign-up name to the legal name a
 * bank shows (security rule 10: payment data, admin-only).
 *
 * An alias is a `kind: 'alias'` row in `clubSettings` (PK `/id`, GROUP
 * scoped), beside the shop sign, the offered strings, the gift cards and the
 * string purchases — NOT a container of its own since 2026-10-14
 * (`docs/plans/container-fold.md`). `aliases` was the one container in the
 * account running on its own dedicated throughput, so it alone doubled the
 * Cosmos bill, for a few dozen rows.
 *
 * FOLD WINDOW. Until the copy route (`lib/containerFold.ts`) has run and PR 2
 * of the plan has deleted it, every read here is the new home UNION the old
 * container, deduplicated by id, and an edit of a row that exists only in the
 * old container MOVES it. So nothing is unreadable between the deploy and the
 * copy, and a row is never edited in a home that is about to be deleted.
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
/** The container being folded away. Read-only here; deleted in PR 2. */
const LEGACY = 'aliases' as const;

function isAlias(row: unknown): row is Alias {
  const r = row as Partial<Alias> | null;
  return !!r && r.kind === ALIAS_KIND && typeof r.id === 'string' && typeof r.appName === 'string' && typeof r.etransferName === 'string';
}

function fromLegacy(row: Alias): Alias {
  return { ...row, kind: ALIAS_KIND };
}

/** Every alias of the group, by app name. */
export async function readAliases(scope: GroupScope): Promise<Alias[]> {
  await ensureClubSettings();
  const rows = (await scope.query<Alias>(HOME, { where: `c.kind = '${ALIAS_KIND}'` })).filter(isAlias);
  const seen = new Set(rows.map((r) => r.id));
  for (const legacy of await scope.query<Alias>(LEGACY)) {
    if (!seen.has(legacy.id)) rows.push(fromLegacy(legacy));
  }
  return rows.sort((a, b) => a.appName.localeCompare(b.appName));
}

/** One alias by id, from whichever home holds it. */
export async function readAlias(scope: GroupScope, id: string): Promise<Alias | undefined> {
  await ensureClubSettings();
  const row = await scope.read<Alias>(HOME, id);
  if (isAlias(row)) return row;
  const legacy = await scope.read<Alias>(LEGACY, id);
  return legacy ? fromLegacy(legacy) : undefined;
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

/**
 * Replace an alias. `undefined` when no home holds it. A row found only in
 * the old container is written to the new home and removed from the old one
 * — touching a legacy row moves it.
 */
export async function updateAlias(scope: GroupScope, next: Alias): Promise<Alias | undefined> {
  await ensureClubSettings();
  const inHome = await scope.read<Alias>(HOME, next.id);
  if (isAlias(inHome)) {
    return scope.replace<Alias>(HOME, { ...inHome, ...next, kind: ALIAS_KIND });
  }
  const legacy = await scope.read<Alias>(LEGACY, next.id);
  if (!legacy) return undefined;
  const { _etag: _e, ...rest } = legacy as Alias & { _etag?: string };
  const { _etag: _n, ...change } = next as Alias & { _etag?: string };
  const moved = await scope.create<Alias>(HOME, { ...rest, ...change, kind: ALIAS_KIND });
  await scope.remove(LEGACY, next.id);
  return moved;
}

/** Delete an alias from whichever home holds it. `false` when neither does. */
export async function removeAlias(scope: GroupScope, id: string): Promise<boolean> {
  await ensureClubSettings();
  // Verify the kind before removing: `remove` checks the group, not what the
  // doc is, and a gift card shares the container.
  const inHome = await scope.read<Alias>(HOME, id);
  if (isAlias(inHome)) return scope.remove(HOME, id);
  return scope.remove(LEGACY, id);
}
