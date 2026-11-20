import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockStore, setupAdminPin, seedTestAdminMember, getTestAdminName, seedMember, makeRequest, getStore } from './helpers';
import { hashPin, FAKE_HASH } from '../lib/recoveryHash';
import { FREE_ATTEMPTS } from '../lib/pinLockPolicy';
import { POST as adminLogin } from '@/app/api/admin/route';
import { POST as recover } from '@/app/api/players/recover/route';

/**
 * A BURST OF GUESSES (Claude Security F8/F9, 2026-11-17). Every PIN site read
 * the lock from the doc it loaded before its scrypt and counted the failure
 * after, so guesses sent at once all saw "unlocked" and every one of them was
 * compared against the real PIN. The guess is now counted BEFORE the compare,
 * so however many arrive together, only the ones counted while the account
 * was still unlocked reach the real hash.
 *
 * `verifyPin` is wrapped to count compares against anything but FAKE_HASH.
 */
const real = { compares: 0 };
vi.mock('../lib/recoveryHash', async (orig) => {
  const mod = await orig<typeof import('../lib/recoveryHash')>();
  return {
    ...mod,
    verifyPin: async (pin: string, hash: string) => {
      if (hash !== mod.FAKE_HASH) real.compares++;
      return mod.verifyPin(pin, hash);
    },
  };
});

const BURST = 20;

/** Every Cosmos document carries an etag; the mock mints one only on a write,
 *  so a seeded account gets one here, as it would have in production. */
function stamp(id: string): void {
  const doc = (getStore()['members'] as Array<{ id: string; _etag?: string }>).find((m) => m.id === id)!;
  doc._etag = 'seeded';
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  real.compares = 0;
});

describe('a parallel burst reaches the real PIN at most FREE_ATTEMPTS + 1 times', () => {
  it('POST /api/admin', async () => {
    await seedTestAdminMember();
    stamp('member-test-admin');
    real.compares = 0;
    const guesses = Array.from({ length: BURST }, (_, i) =>
      adminLogin(makeRequest('POST', 'http://x/api/admin', { name: getTestAdminName(), pin: String(1000 + i * 7) })));
    const answers = await Promise.all(guesses);
    // A wrong PIN, or paused once the lock forms: never a way in.
    expect(answers.every((r) => r.status === 401 || r.status === 429)).toBe(true);
    expect(real.compares).toBeLessThanOrEqual(FREE_ATTEMPTS + 1);
  });

  it('POST /api/players/recover', async () => {
    const lin = seedMember('Lin', { pinHash: await hashPin('2468') });
    stamp(lin.id);
    real.compares = 0;
    const guesses = Array.from({ length: BURST }, (_, i) =>
      recover(makeRequest('POST', 'http://x/api/players/recover', { name: 'Lin', pin: String(3000 + i * 7) })));
    await Promise.all(guesses);
    expect(real.compares).toBeLessThanOrEqual(FREE_ATTEMPTS + 1);
  });
});

// FAKE_HASH is imported so the wrapped module's identity is the one compared.
void FAKE_HASH;
