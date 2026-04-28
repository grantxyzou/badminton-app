import { randomInt } from 'crypto';
import { hashPin, verifyPin } from './recoveryHash';

const TTL_MS = 15 * 60 * 1000;

interface ActiveCode {
  playerId: string;
  sessionId: string;
  codeHash: string;
  expiresAt: number;
}

const activeCodes = new Map<string, ActiveCode>();

export async function issueCode(
  playerId: string,
  sessionId: string,
): Promise<{ code: string; expiresAt: number }> {
  const code = String(randomInt(100000, 1000000));
  const codeHash = await hashPin(code);
  const expiresAt = Date.now() + TTL_MS;
  activeCodes.set(playerId, { playerId, sessionId, codeHash, expiresAt });
  return { code, expiresAt };
}

/**
 * Returns true if the candidate matches a still-valid code for this player.
 * On match, the entry is consumed (single-use). On expiry, the entry is
 * deleted as a side effect.
 */
export async function consumeCode(playerId: string, candidate: string): Promise<boolean> {
  const entry = activeCodes.get(playerId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    activeCodes.delete(playerId);
    return false;
  }
  const ok = await verifyPin(candidate, entry.codeHash);
  if (ok) activeCodes.delete(playerId);
  return ok;
}

export function invalidateCode(playerId: string): void {
  activeCodes.delete(playerId);
}

/** Test-only — never call from app code. */
export function __resetForTests(): void {
  activeCodes.clear();
}
