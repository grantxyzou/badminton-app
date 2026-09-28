/**
 * PER-ACCOUNT PIN LOCKOUT.
 *
 * A PIN is four digits: ten thousand guesses. Every guard on a PIN check was
 * keyed on the caller's IP (or the name AND the IP), so an attacker rotating
 * source addresses had five fresh guesses per address and two thousand
 * addresses covered the space — and `recoveryEvents` recorded every failed
 * attempt without anything ever reading it to refuse. This is the counter
 * that lives with the ACCOUNT, however it is addressed and wherever from.
 *
 * Policy: `FREE_ATTEMPTS` consecutive failures cost nothing; the next locks
 * the account for `BASE_LOCK_MS`, and each further failure doubles it up to
 * `MAX_LOCK_MS`. A correct PIN clears the counter. Failures older than
 * `DECAY_MS` are forgotten, so a person who mistyped last month is not one
 * step from a lock today. Under lock the answer is the SAME generic 401 as a
 * wrong PIN (a "locked, try in 4 minutes" would be an oracle saying the
 * account exists and has a PIN), and a guess made while locked neither
 * counts nor extends the lock — otherwise one hammering attacker keeps the
 * real owner out forever. Locked or not, the miss still pays its scrypt.
 *
 * The state is an additive optional field on the Member doc (`pinLock`),
 * written with the same read-then-upsert the recovery audit trail uses. The
 * helpers also update the in-memory doc they were handed, because every
 * call site goes on to spread that same object into its own write — a
 * stale `pinLock` spread back over a just-cleared one would re-lock the
 * person who had just proved who they were.
 */
import { getContainer } from './cosmos';
import type { PinLock } from './types';

/** The call sites hold the member as a loosely typed doc (a scan row, a
 *  point read's `resource`); only the id and the lock matter here. */
type LockableMember = { id: string; pinLock?: unknown };

function asLock(v: unknown): PinLock | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const l = v as Partial<PinLock>;
  if (typeof l.failures !== 'number' || typeof l.lastFailedAt !== 'string') return undefined;
  return l as PinLock;
}

export const FREE_ATTEMPTS = 5;
export const BASE_LOCK_MS = 60_000;
export const MAX_LOCK_MS = 60 * 60_000;
export const DECAY_MS = 24 * 60 * 60_000;

export function isPinLocked(value: unknown, now: number = Date.now()): boolean {
  const lock = asLock(value);
  return !!lock?.lockedUntil && Date.parse(lock.lockedUntil) > now;
}

/** The next state after a wrong PIN. Unchanged while locked. */
export function recordPinFailure(value: unknown, now: number = Date.now()): PinLock {
  const lock = asLock(value);
  if (isPinLocked(lock, now)) return lock as PinLock;
  const stale = !lock || now - Date.parse(lock.lastFailedAt) > DECAY_MS;
  const failures = (stale ? 0 : lock.failures) + 1;
  const over = failures - FREE_ATTEMPTS;
  const next: PinLock = { failures, lastFailedAt: new Date(now).toISOString() };
  if (over > 0) {
    const ms = Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (over - 1));
    next.lockedUntil = new Date(now + ms).toISOString();
  }
  return next;
}

/** Record a wrong PIN against the account. Best-effort: a write failure is
 *  logged and never turns the 401 into a 500. */
export async function notePinFailure(member: LockableMember): Promise<void> {
  const next = recordPinFailure(member.pinLock);
  if (next === member.pinLock) return; // locked: nothing to write
  member.pinLock = next;
  try {
    await getContainer('members').items.upsert({ ...member, pinLock: next });
  } catch (err) {
    console.error('[pin-lock] could not record failure:', err);
  }
}

/** A correct PIN clears the counter. No write when there is nothing to clear. */
export async function notePinSuccess(member: LockableMember): Promise<void> {
  if (!member.pinLock) return;
  delete member.pinLock;
  try {
    const doc: Record<string, unknown> = { ...member };
    delete doc.pinLock;
    await getContainer('members').items.upsert(doc);
  } catch (err) {
    console.error('[pin-lock] could not clear:', err);
  }
}
