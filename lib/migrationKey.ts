/**
 * The migration key — the second lock on every admin route that rewrites
 * stored data in bulk (`migrate-groups`, `ledger-backfill`,
 * `migrate-containers`). An admin cookie proves a person; this proves the
 * DEPLOYMENT has decided to migrate, because the key exists only in the App
 * Settings of the one that has. Unset is a 503, never an open door.
 *
 * One owner, so the three routes cannot compare it three ways.
 */
import { createHash, timingSafeEqual } from 'crypto';

export const MIGRATION_KEY_HEADER = 'x-migration-key';

export function migrationKeyConfigured(): boolean {
  return !!process.env.MIGRATION_KEY;
}

/** Hash both sides first so a length difference cannot leak through timing (security rule 11). */
export function migrationKeyMatches(provided: string | null): boolean {
  const expected = process.env.MIGRATION_KEY;
  if (!expected || expected.length < 16 || !provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
