/**
 * THE PIN LOCK'S RULES, with no database (docs/plans/sign-in-redesign.md,
 * step 2): how many tries are free, how long a lock lasts, the seconds left
 * on one, and the in-memory count for a name with no PIN behind it. The
 * account's own counter, which reads and writes the Member doc, is
 * `lib/pinLockout.ts`; it follows these rules.
 */
import type { PinLock } from './types';

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

/** Seconds until a lock ends, rounded up (0 = not locked), for the countdown. */
export function pausedSeconds(value: unknown, now: number = Date.now()): number {
  const lock = asLock(value);
  if (!lock?.lockedUntil) return 0;
  const ms = Date.parse(lock.lockedUntil) - now;
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

/*
 * THE SAME COUNTDOWN FOR A NAME WITH NO PIN BEHIND IT
 * (docs/plans/pin-retirement.md, Decision 6; docs/plans/sign-in-redesign.md,
 * step 2). A locked account now SAYS so — "Let's pause a moment — try again in 3:42"
 * — instead of answering like a wrong PIN. Said for real accounts only, that
 * would list which names hold a PIN. So a name that resolves to nobody, or to
 * an account with no PIN, is counted here on the identical schedule
 * (`recordPinFailure`), and pauses after the same guess for the same time.
 *
 * In memory, on purpose: there is no account to write it on, and a stranger's
 * name must cost no database write. The difference that leaves is a restart
 * (a deploy forgets these counts; an account's lock survives it), which needs
 * the same name watched across a deploy, inside one lock — the per-name rate
 * limit already caps that to a handful of guesses an hour.
 */
const nameLocks = new Map<string, PinLock>();
const NAME_LOCK_CAP = 5000;

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function pruneNameLocks(now: number): void {
  if (nameLocks.size < NAME_LOCK_CAP) return;
  for (const [k, lock] of nameLocks) {
    if (!isPinLocked(lock, now) && now - Date.parse(lock.lastFailedAt) > DECAY_MS) nameLocks.delete(k);
  }
  // Still full: drop the oldest (a Map iterates in insertion order).
  for (const k of nameLocks.keys()) {
    if (nameLocks.size < NAME_LOCK_CAP) break;
    nameLocks.delete(k);
  }
}

/** `claimPinAttempt` for a name with no PIN behind it: `false` while the
 *  name is paused (nothing counted), else the guess is counted and `true`. */
export function claimNameAttempt(name: string, now: number = Date.now()): boolean {
  pruneNameLocks(now);
  const key = nameKey(name);
  const lock = nameLocks.get(key);
  if (isPinLocked(lock, now)) return false;
  // Re-insert so the Map's order stays oldest-first for the prune above.
  nameLocks.delete(key);
  nameLocks.set(key, recordPinFailure(lock, now));
  return true;
}

/** Seconds left on a name's pause (0 = none). */
export function nameLockSeconds(name: string, now: number = Date.now()): number {
  return pausedSeconds(nameLocks.get(nameKey(name)), now);
}

/** Tests only. */
export function resetNameLocks(): void {
  nameLocks.clear();
}

