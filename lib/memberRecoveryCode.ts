import { randomInt } from 'crypto';
import { hashPin, verifyPin } from './recoveryHash';

/**
 * Member-scoped PIN-reset codes.
 *
 * These replace the old in-memory `lib/recoveryCodes.ts` map, which lost every
 * issued code whenever the Azure B1 instance cold-started (~20 min idle). The
 * code now lives on the member doc (`member.recoveryCode`), so it survives
 * restarts and isn't tied to a session-scoped player record. Single active
 * code per member; consuming it deletes the field.
 */

const TTL_MS = 15 * 60 * 1000;

export interface StoredRecoveryCode {
  hash: string;
  expiresAt: number;
}

/**
 * Generate a fresh 6-digit code. Returns the plaintext `code` (shown once to
 * the admin) plus the `{ hash, expiresAt }` pair to persist on the member doc.
 */
export async function issueRecoveryCode(): Promise<{
  code: string;
  stored: StoredRecoveryCode;
}> {
  const code = String(randomInt(100000, 1000000));
  const hash = await hashPin(code);
  return { code, stored: { hash, expiresAt: Date.now() + TTL_MS } };
}

/**
 * Returns true if `candidate` matches the stored code and it hasn't expired.
 * Verification is constant-time via `verifyPin`. Callers are responsible for
 * clearing `member.recoveryCode` after a successful (single-use) match.
 */
export async function verifyRecoveryCode(
  stored: StoredRecoveryCode | undefined | null,
  candidate: string,
): Promise<boolean> {
  if (!stored || typeof stored.hash !== 'string' || typeof stored.expiresAt !== 'number') {
    return false;
  }
  if (Date.now() > stored.expiresAt) return false;
  return verifyPin(candidate, stored.hash);
}
