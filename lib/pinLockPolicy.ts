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
 * THE COUNTDOWN A PERSON SEES: ONE COUNT PER NAME, FOR EVERY NAME
 * (docs/plans/pin-retirement.md, Decision 6; docs/plans/sign-in-redesign.md,
 * step 2). A paused PIN check now SAYS so — "Let's pause a moment — try again
 * in 3:42" — instead of answering like a wrong PIN.
 *
 * What it shows must not depend on whether the name has an account, a PIN or
 * a rank, or the countdown lists them. So the VISIBLE answer comes from this
 * count alone: every PIN check at every route (sign-in, console, Update PIN,
 * "Is that you?") counts the guess against the name as typed, before looking
 * anything up, and pauses only from here. The account's own lock
 * (`lib/pinLockout.ts`, `Member.pinLock`) still decides whether a guess is
 * COMPARED — it is the real guard, across addresses and restarts — but when
 * it refuses and the name is not paused, the answer is the plain wrong-PIN
 * 401 it always was. A first cut showed the account's lock where there was
 * one and this count elsewhere; a few guesses split across two routes then
 * told a PIN holder from a nobody (security review, 2026-11-20).
 *
 * A correct PIN does NOT clear it: a nobody's count can never be cleared, so
 * a cleared one would say someone signed in under the name. It forgets a
 * miss a day old, as the account lock does.
 *
 * In memory, on purpose: a stranger's name must cost no database write. A
 * deploy forgets it, for every name alike. Bounded: a key is the first 64
 * characters of the tidied name, and a full map drops only entries that are
 * neither paused nor counting toward a pause; while it is full of those, a
 * new name is not counted (and so never shows a countdown, for every name
 * alike) rather than evicting a paused one, which would let a flood of new
 * names unpause a name on demand.
 */
const nameLocks = new Map<string, PinLock>();
const NAME_LOCK_CAP = 10_000;
const NAME_KEY_MAX = 64;
let lastPrune = 0;

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, NAME_KEY_MAX);
}

/** Free room by dropping entries that can no longer matter: not paused, and
 *  their last miss old enough to be forgotten. At most once a minute. */
function pruneNameLocks(now: number): void {
  if (nameLocks.size < NAME_LOCK_CAP || now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [k, lock] of nameLocks) {
    if (!isPinLocked(lock, now) && now - Date.parse(lock.lastFailedAt) > DECAY_MS) nameLocks.delete(k);
  }
}

/** Count a PIN guess at a name. `false` while the name is paused (nothing
 *  counted): refuse without comparing. Call it at every PIN check, BEFORE
 *  the name is looked up. */
export function claimNameAttempt(name: string, now: number = Date.now()): boolean {
  const key = nameKey(name);
  const lock = nameLocks.get(key);
  if (isPinLocked(lock, now)) return false;
  if (!lock) {
    pruneNameLocks(now);
    if (nameLocks.size >= NAME_LOCK_CAP) return true; // full: not counted, for every name alike
  }
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
  lastPrune = 0;
}

