/**
 * Single-use, hashed, expiring tokens for the two emailed flows: address
 * verification and password reset.
 *
 * WHY SHA-256 AND NOT SCRYPT
 * --------------------------
 * `lib/passwordHash.ts` and `lib/recoveryHash.ts` both stretch deliberately,
 * because a password or a 4-digit PIN is low-entropy and an attacker who
 * captures the stored value can attack it offline with a dictionary. A token
 * from `randomBytes(32)` has 256 bits of entropy: there is no dictionary, and
 * no amount of stretching improves a search space that is already infeasible.
 * All stretching would buy is latency on every verification click — 64 MiB and
 * ~100ms per link tap, for nothing.
 *
 * Hashing at all still matters: a leaked database dump must not contain live
 * tokens that grant an account takeover.
 *
 * Single use is enforced by the CALLER deleting the record on success — this
 * module deliberately holds no state of its own.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export interface TokenRecord {
  /** SHA-256 of the emailed token, hex. */
  hash: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** 24 hours. A verification link often sits unread in a mailbox overnight. */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 1 hour. Shorter than verification on purpose: a reset link is a live
 * credential — anyone holding it can take the account — whereas a verification
 * link only confirms an address the account already claims.
 */
export const RESET_TTL_MS = 60 * 60 * 1000;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createToken(ttlMs: number): { token: string; record: TokenRecord } {
  const token = randomBytes(32).toString('hex');
  return {
    token,
    record: { hash: sha256Hex(token), expiresAt: Date.now() + ttlMs },
  };
}

/**
 * Constant-time comparison against a stored record. Returns false — never
 * throws — for an absent, malformed or expired record, so callers can pass a
 * possibly-undefined field straight through.
 */
export function checkToken(token: string, record: TokenRecord | undefined | null): boolean {
  if (!record || typeof record.hash !== 'string' || typeof record.expiresAt !== 'number') {
    return false;
  }
  if (!/^[0-9a-f]{64}$/.test(record.hash)) return false;
  if (typeof token !== 'string' || token.length === 0) return false;
  if (record.expiresAt < Date.now()) return false;
  const candidate = Buffer.from(sha256Hex(token), 'hex');
  const expected = Buffer.from(record.hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
