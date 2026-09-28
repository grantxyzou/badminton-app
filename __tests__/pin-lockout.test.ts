import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore, setupAdminPin, seedTestAdminMember, getTestPin, getTestAdminName,
  seedMember, makeRequest, getStore,
} from './helpers';
import { hashPin } from '../lib/recoveryHash';
import {
  isPinLocked, recordPinFailure, FREE_ATTEMPTS, BASE_LOCK_MS, MAX_LOCK_MS, DECAY_MS,
} from '../lib/pinLockout';
import { POST as adminLogin } from '@/app/api/admin/route';
import { POST as recover } from '@/app/api/players/recover/route';

/**
 * A PIN is four digits, and every guard on a PIN check was keyed on the
 * caller's IP — five fresh guesses per rotated address. The lock lives with
 * the ACCOUNT. Every request here carries a unique IP (helpers), so the IP
 * limiters never fire and what is measured is the account's own counter.
 */
describe('pin lockout policy', () => {
  it('free attempts, then a lock that doubles and caps', () => {
    const t0 = Date.parse('2026-09-28T10:00:00Z');
    let lock = recordPinFailure(undefined, t0);
    for (let i = 1; i < FREE_ATTEMPTS; i++) lock = recordPinFailure(lock, t0 + i);
    expect(lock.failures).toBe(FREE_ATTEMPTS);
    expect(isPinLocked(lock, t0 + FREE_ATTEMPTS)).toBe(false);

    // Sixth failure: locked for BASE_LOCK_MS.
    lock = recordPinFailure(lock, t0 + 10);
    expect(isPinLocked(lock, t0 + 10)).toBe(true);
    expect(Date.parse(lock.lockedUntil!) - (t0 + 10)).toBe(BASE_LOCK_MS);
    expect(isPinLocked(lock, t0 + 10 + BASE_LOCK_MS)).toBe(false);

    // While locked a failure changes nothing (no extension by hammering).
    const same = recordPinFailure(lock, t0 + 20);
    expect(same).toBe(lock);

    // After it lapses, the next failure doubles the lock.
    const t1 = t0 + 10 + BASE_LOCK_MS + 1;
    lock = recordPinFailure(lock, t1);
    expect(Date.parse(lock.lockedUntil!) - t1).toBe(BASE_LOCK_MS * 2);

    // Many more: capped.
    let t = t1;
    for (let i = 0; i < 12; i++) {
      t = Date.parse(lock.lockedUntil!) + 1;
      lock = recordPinFailure(lock, t);
    }
    expect(Date.parse(lock.lockedUntil!) - t).toBe(MAX_LOCK_MS);
  });

  it('failures older than a day are forgotten', () => {
    const t0 = Date.parse('2026-09-28T10:00:00Z');
    let lock = recordPinFailure(undefined, t0);
    for (let i = 1; i < FREE_ATTEMPTS; i++) lock = recordPinFailure(lock, t0 + i);
    lock = recordPinFailure(lock, t0 + FREE_ATTEMPTS + DECAY_MS + 1);
    expect(lock.failures).toBe(1);
    expect(lock.lockedUntil).toBeUndefined();
  });

  it('tolerates a malformed stored value', () => {
    expect(isPinLocked('garbage')).toBe(false);
    expect(isPinLocked({ lockedUntil: 'x' })).toBe(false);
    expect(recordPinFailure({ nope: true }).failures).toBe(1);
  });
});

describe('POST /api/admin — the account locks after repeated wrong PINs', () => {
  const URL = 'http://localhost:3000/api/admin';
  beforeEach(async () => {
    setupAdminPin();
    resetMockStore();
    await seedTestAdminMember();
  });
  const admin = () => (getStore()['members'] as Array<{ id: string; pinLock?: { failures: number; lockedUntil?: string } }>)
    .find((m) => m.id === 'member-test-admin')!;

  it('counts failures on the member, refuses the RIGHT PIN while locked, and clears on success', async () => {
    for (let i = 0; i < FREE_ATTEMPTS; i++) {
      const res = await adminLogin(makeRequest('POST', URL, { name: getTestAdminName(), pin: '9999' }));
      expect(res.status).toBe(401);
    }
    expect(admin().pinLock?.failures).toBe(FREE_ATTEMPTS);
    expect(admin().pinLock?.lockedUntil).toBeUndefined();

    // One more wrong guess locks it...
    expect((await adminLogin(makeRequest('POST', URL, { name: getTestAdminName(), pin: '9999' }))).status).toBe(401);
    expect(admin().pinLock?.lockedUntil).toBeDefined();
    // ...and the correct PIN is refused with the SAME answer while it holds.
    const locked = await adminLogin(makeRequest('POST', URL, { name: getTestAdminName(), pin: getTestPin() }));
    expect(locked.status).toBe(401);
    expect(await locked.json()).toEqual({ error: 'Incorrect name or PIN' });

    // Lapse the lock (the store is the test seam), then the right PIN clears it.
    admin().pinLock!.lockedUntil = new Date(Date.now() - 1000).toISOString();
    const ok = await adminLogin(makeRequest('POST', URL, { name: getTestAdminName(), pin: getTestPin() }));
    expect(ok.status).toBe(200);
    expect(admin().pinLock).toBeUndefined();
  });
});

describe('POST /api/players/recover — same lock, same generic answer', () => {
  const URL = 'http://localhost:3000/api/players/recover';
  beforeEach(async () => {
    resetMockStore();
    setupAdminPin();
  });

  it('locks the account and refuses the right PIN while locked', async () => {
    const lin = seedMember('Lin', { pinHash: await hashPin('2468') });
    const doc = () => (getStore()['members'] as Array<{ id: string; pinLock?: { lockedUntil?: string } }>).find((m) => m.id === lin.id)!;
    for (let i = 0; i <= FREE_ATTEMPTS; i++) {
      expect((await recover(makeRequest('POST', URL, { name: 'Lin', pin: '0000' }))).status).toBe(401);
    }
    expect(doc().pinLock?.lockedUntil).toBeDefined();
    expect((await recover(makeRequest('POST', URL, { name: 'Lin', pin: '2468' }))).status).toBe(401);

    doc().pinLock!.lockedUntil = new Date(Date.now() - 1000).toISOString();
    const ok = await recover(makeRequest('POST', URL, { name: 'Lin', pin: '2468' }));
    expect(ok.status).toBe(200);
    expect(doc().pinLock).toBeUndefined();
  });
});
