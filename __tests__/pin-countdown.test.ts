import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore, setupAdminPin, seedTestAdminMember, getTestAdminName,
  seedMember, makeRequest,
} from './helpers';
import { hashPin } from '../lib/recoveryHash';
import { claimNameAttempt, nameLockSeconds, recordPinFailure, pausedSeconds, FREE_ATTEMPTS, DECAY_MS } from '../lib/pinLockPolicy';
import { POST as adminLogin } from '@/app/api/admin/route';
import { POST as recover } from '@/app/api/players/recover/route';
import { PATCH as patchMe } from '@/app/api/members/me/route';

/**
 * docs/plans/sign-in-redesign.md, step 2 (and pin-retirement.md, Decision 6):
 * a paused PIN check SAYS so, with the seconds left — "Let's pause a moment —
 * try again in 3:42" — and it says it for EVERY name on the same schedule, so the
 * countdown is no list of which names hold a PIN. A real account's comes from
 * its `pinLock`; a name with no PIN behind it from an in-memory count kept on
 * the identical schedule.
 *
 * Every request here carries its own address (helpers), so the per-caller
 * limits never fire: what is measured is the name's own count.
 */

type Answer = { status: number; error?: string; retryAfter?: number };

async function read(res: Response): Promise<Answer> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; retryAfter?: number };
  return { status: res.status, error: body.error, retryAfter: body.retryAfter };
}

/** Seven wrong guesses at one name; the status and the paused seconds of each. */
async function sevenGuesses(send: () => Promise<Response>): Promise<Array<[number, number | undefined]>> {
  const out: Array<[number, number | undefined]> = [];
  for (let i = 0; i < FREE_ATTEMPTS + 2; i++) {
    const a = await read(await send());
    if (a.status === 429) expect(a.error).toBe('pin_paused');
    out.push([a.status, a.retryAfter === undefined ? undefined : Math.round(a.retryAfter / 10) * 10]);
  }
  return out;
}

const EXPECTED: Array<[number, number | undefined]> = [
  [401, undefined],
  [401, undefined],
  [401, undefined],
  [401, undefined],
  [401, undefined],
  [429, 60], // the sixth guess locks the name for a minute, and says so
  [429, 60], // a guess while paused counts nothing and gets the time left
];

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
});

describe('the in-memory count for a name with no PIN', () => {
  it('runs on the account lock\'s own schedule', () => {
    const now = Date.parse('2026-11-20T10:00:00Z');
    let lock: ReturnType<typeof recordPinFailure> | undefined;
    for (let i = 0; i < FREE_ATTEMPTS + 3; i++) {
      // Paused or not, both sides agree on every guess.
      const accountPaused = pausedSeconds(lock, now + i);
      expect(claimNameAttempt('Nobody Here', now + i)).toBe(accountPaused === 0);
      if (accountPaused === 0) lock = recordPinFailure(lock, now + i);
      expect(nameLockSeconds('nobody  here', now + i)).toBe(pausedSeconds(lock, now + i));
    }
  });

  it('forgets a day-old miss, as the account lock does', () => {
    const now = Date.parse('2026-11-20T10:00:00Z');
    for (let i = 0; i < FREE_ATTEMPTS; i++) claimNameAttempt('Ghost', now);
    claimNameAttempt('Ghost', now + DECAY_MS + 1);
    expect(nameLockSeconds('Ghost', now + DECAY_MS + 2)).toBe(0);
  });
});

describe('POST /api/players/recover — the same countdown for every name', () => {
  const send = (name: string) => () =>
    recover(makeRequest('POST', 'http://x/api/players/recover', { name, pin: '0000' }));

  it('a name with a PIN, a name nobody holds and a member with no PIN answer alike', async () => {
    seedMember('Lin', { pinHash: await hashPin('2468') });
    seedMember('Kento');
    expect(await sevenGuesses(send('Lin'))).toEqual(EXPECTED);
    expect(await sevenGuesses(send('Nobody'))).toEqual(EXPECTED);
    expect(await sevenGuesses(send('Kento'))).toEqual(EXPECTED);
  });

  it('carries Retry-After, and the right PIN waits too', async () => {
    seedMember('Lin', { pinHash: await hashPin('2468') });
    await sevenGuesses(send('Lin'));
    const res = await recover(makeRequest('POST', 'http://x/api/players/recover', { name: 'Lin', pin: '2468' }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('pin_paused');
    expect(res.headers.get('Retry-After')).toBe(String(body.retryAfter));
  });
});

describe('POST /api/admin — the same countdown for every name', () => {
  const send = (name: string) => () => adminLogin(makeRequest('POST', 'http://x/api/admin', { name, pin: '0000' }));

  it('an admin, a name nobody holds and a player who is not an admin answer alike', async () => {
    await seedTestAdminMember();
    seedMember('Kento', { pinHash: await hashPin('2468') });
    expect(await sevenGuesses(send(getTestAdminName()))).toEqual(EXPECTED);
    expect(await sevenGuesses(send('Nobody'))).toEqual(EXPECTED);
    expect(await sevenGuesses(send('Kento'))).toEqual(EXPECTED);
  });

  it('the per-caller limit counts down too, from its own window', async () => {
    const ip = { 'X-Client-IP': '10.9.9.9' };
    for (let i = 0; i < 5; i++) await adminLogin(makeRequest('POST', 'http://x/api/admin', { name: 'Nobody', pin: '0000' }, ip));
    const a = await read(await adminLogin(makeRequest('POST', 'http://x/api/admin', { name: 'Anyone', pin: '0000' }, ip)));
    expect(a.status).toBe(429);
    expect(a.error).toBe('pin_paused');
    expect(a.retryAfter).toBeGreaterThan(14 * 60);
    expect(a.retryAfter).toBeLessThanOrEqual(15 * 60);
  });
});

describe('PATCH /api/members/me — a signed-out current-PIN guess counts down alike', () => {
  const send = (name: string) => () =>
    patchMe(makeRequest('PATCH', 'http://x/api/members/me', { name, currentPin: '0000', newPin: '5937' }));

  it('a member with a PIN and a name nobody holds answer alike', async () => {
    seedMember('Lin', { pinHash: await hashPin('2468') });
    expect(await sevenGuesses(send('Lin'))).toEqual(EXPECTED);
    expect(await sevenGuesses(send('Nobody'))).toEqual(EXPECTED);
  });
});
