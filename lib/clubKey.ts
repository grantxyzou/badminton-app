import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * A per-club machine key: `<groupId>.<48 hex>`. Shared by the payments inbox
 * (`x-payments-key`) and the weekly reports (`x-reports-key`), which are
 * separate keys on purpose — a leaked reports key must not mark anyone paid,
 * and a leaked payments key must not read feedback.
 *
 * The key carries its group because the caller (a Gmail script, a scheduled
 * helper) has no cookie to say which club it is. Only the sha256 is stored;
 * the plaintext exists once, in the mint response.
 */

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

const GROUP_ID_SHAPE = /^[a-z0-9]{1,64}$/;

/** A fresh key for `groupId`, and the hash to store. */
export function newClubKey(groupId: string): { key: string; keyHash: string } {
  const key = `${groupId}.${randomBytes(24).toString('hex')}`;
  return { key, keyHash: sha256Hex(key) };
}

/** The group a presented key NAMES (shape only — nothing is verified yet), or null. */
export function groupNamedByKey(provided: string | null): string | null {
  if (!provided || provided.length > 200) return null;
  const dot = provided.indexOf('.');
  const groupId = dot > 0 ? provided.slice(0, dot) : '';
  return GROUP_ID_SHAPE.test(groupId) ? groupId : null;
}

/** Hashed both sides, compared in constant time (security rules 2 and 11). */
export function keyMatchesHash(provided: string, keyHash: string | undefined): boolean {
  if (!keyHash) return false;
  const a = Buffer.from(sha256Hex(provided), 'hex');
  const b = Buffer.from(keyHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
