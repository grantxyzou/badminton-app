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
 *  logged and never turns the 401 into a 500.
 *
 *  COUNTED ON A FRESH READ, UNDER `IfMatch` (audit, 2026-11-05). It used to
 *  write `{ ...member, pinLock }` from the doc the caller read before its
 *  scrypt, so twenty guesses sent at once all read "0 failures" and all wrote
 *  "1": the lock never formed, however many arrived in parallel. Now each
 *  failure re-reads and adds to what is THERE, retrying when another lands
 *  first, so a burst counts in full and locks the account behind it. */
export async function notePinFailure(member: LockableMember): Promise<void> {
  const container = getContainer('members');
  for (let attempt = 0; attempt < 5; attempt++) {
    let fresh: (LockableMember & { _etag?: string }) | undefined;
    try {
      ({ resource: fresh } = await container.item(member.id, member.id).read<LockableMember & { _etag?: string }>());
    } catch {
      fresh = undefined;
    }
    const base = fresh ?? member;
    const next = recordPinFailure(base.pinLock);
    member.pinLock = next;
    if (next === base.pinLock) return; // locked: nothing to write
    try {
      if (fresh && typeof fresh._etag === 'string') {
        await container
          .item(member.id, member.id)
          .replace({ ...fresh, pinLock: next }, { accessCondition: { type: 'IfMatch', condition: fresh._etag } });
      } else {
        await container.items.upsert({ ...base, pinLock: next });
      }
      return;
    } catch (err) {
      const code = (err as { code?: number; statusCode?: number })?.code ?? (err as { statusCode?: number })?.statusCode;
      if (code === 412) continue; // another failure landed first: count on top of it
      console.error('[pin-lock] could not record failure:', err);
      return;
    }
  }
  console.error('[pin-lock] gave up recording a failure after repeated conflicts');
}

/**
 * COUNT THE GUESS BEFORE COMPARING IT (Claude Security F8/F9, 2026-11-17).
 *
 * `notePinFailure` counted a wrong PIN AFTER its scrypt, and every site read
 * the lock from the doc it loaded BEFORE that scrypt. So a burst sent at once
 * all read "unlocked", and every guess in it was compared before the first
 * failure was written: the lock bounded nothing against a parallel attack
 * from rotating addresses, the case it exists for.
 *
 * Now each guess is counted FIRST, as a provisional failure, on a fresh read
 * under `IfMatch`, retried when another guess lands first. Those writes are
 * serialized by the etag, so only the guesses whose count landed while the
 * account was unlocked are compared: `FREE_ATTEMPTS` + 1 in any burst, then
 * the lock refuses the rest. A correct PIN clears the count
 * (`notePinSuccess`); a wrong one leaves it, already recorded.
 *
 * `true` = compare this guess. `false` = locked, or the count could not be
 * written: FAIL CLOSED, answer as a wrong PIN (and still pay a scrypt against
 * FAKE_HASH, so a refusal costs what a guess costs). The in-memory doc gets
 * the new lock, because call sites spread it into their own later writes.
 */
export async function claimPinAttempt(member: LockableMember, now: number = Date.now()): Promise<boolean> {
  const container = getContainer('members');
  for (let attempt = 0; attempt < 8; attempt++) {
    let fresh: (LockableMember & { _etag?: string }) | undefined;
    try {
      ({ resource: fresh } = await container.item(member.id, member.id).read<LockableMember & { _etag?: string }>());
    } catch (err) {
      console.error('[pin-lock] could not read the account to count a guess:', err);
      return false;
    }
    if (!fresh) return false;
    if (isPinLocked(fresh.pinLock, now)) {
      member.pinLock = fresh.pinLock;
      return false;
    }
    const next = recordPinFailure(fresh.pinLock, now);
    try {
      if (typeof fresh._etag === 'string') {
        await container
          .item(member.id, member.id)
          .replace({ ...fresh, pinLock: next }, { accessCondition: { type: 'IfMatch', condition: fresh._etag } });
      } else {
        await container.items.upsert({ ...fresh, pinLock: next });
      }
      member.pinLock = next;
      return true;
    } catch (err) {
      const code = (err as { code?: number; statusCode?: number })?.code ?? (err as { statusCode?: number })?.statusCode;
      if (code === 412) continue; // another guess was counted first: count on top of it
      console.error('[pin-lock] could not count a guess:', err);
      return false;
    }
  }
  console.error('[pin-lock] refusing a guess after repeated conflicts');
  return false;
}

/** A correct PIN: clear the count, on a fresh read so it cannot write a stale
 *  copy of the rest of the account back over a newer one. Best-effort. */
export async function notePinSuccess(member: LockableMember): Promise<void> {
  if (!member.pinLock) return;
  delete member.pinLock;
  const container = getContainer('members');
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { resource: fresh } = await container
        .item(member.id, member.id)
        .read<LockableMember & { _etag?: string }>();
      if (!fresh || !fresh.pinLock) return;
      const doc: Record<string, unknown> = { ...fresh };
      delete doc.pinLock;
      if (typeof fresh._etag === 'string') {
        await container.item(member.id, member.id).replace(doc, { accessCondition: { type: 'IfMatch', condition: fresh._etag } });
      } else {
        await container.items.upsert(doc);
      }
      return;
    } catch (err) {
      const code = (err as { code?: number; statusCode?: number })?.code ?? (err as { statusCode?: number })?.statusCode;
      if (code === 412) continue;
      console.error('[pin-lock] could not clear:', err);
      return;
    }
  }
}
