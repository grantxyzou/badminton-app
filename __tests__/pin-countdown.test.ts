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
      expect(claimNameAttempt('Nobody Here', now + i) !== null).toBe(accountPaused === 0);
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

/**
 * The first cut showed an account's own lock where there was one and an
 * in-memory count elsewhere; which one a guess landed on depended on the
 * route, so a few guesses split across routes told a PIN holder from a
 * nobody, and an admin from a player (security review, 2026-11-20). The
 * countdown now comes from ONE count per name at every route. These run the
 * reviewer's sequences against an admin, a player with a PIN, a player
 * without one and a name nobody holds, and need every answer to match.
 */
describe('mixing routes and spellings tells nobody apart', () => {
  const recoverAt = (name: string) => () => recover(makeRequest('POST', 'http://x/api/players/recover', { name, pin: '0000' }));
  const adminAt = (name: string) => () => adminLogin(makeRequest('POST', 'http://x/api/admin', { name, pin: '0000' }));
  const meAt = (name: string) => () =>
    patchMe(makeRequest('PATCH', 'http://x/api/members/me', { name, currentPin: '0000', newPin: '5937' }));

  async function run(steps: Array<() => Promise<Response>>): Promise<string[]> {
    const out: string[] = [];
    for (const step of steps) {
      const a = await read(await step());
      out.push(a.status === 429 ? `paused ${Math.round((a.retryAfter ?? 0) / 10) * 10}` : String(a.status));
    }
    return out;
  }

  async function seedAll() {
    resetMockStore();
    setupAdminPin();
    await seedTestAdminMember();
    seedMember('Kento', { pinHash: await hashPin('2468') });
    seedMember('Akane');
  }

  const sequences: Array<[string, (n: string) => Array<() => Promise<Response>>]> = [
    ['five at the console, then one at sign-in', (n) => [...Array(5).fill(adminAt(n)), recoverAt(n)]],
    ['five at sign-in, then one at the console', (n) => [...Array(5).fill(recoverAt(n)), adminAt(n)]],
    ['five at Update PIN, then one at sign-in', (n) => [...Array(5).fill(meAt(n)), recoverAt(n)]],
    ['five at a spaced-out spelling, then one at the name', (n) => [...Array(5).fill(recoverAt(n.replace(/^(.)/, '$1 ').replace(' ', '  '))), recoverAt(n)]],
  ];

  for (const [label, steps] of sequences) {
    it(label, async () => {
      const answers: Record<string, string[]> = {};
      for (const who of ['admin', 'Kento', 'Akane', 'Nobody']) {
        await seedAll();
        const name = who === 'admin' ? getTestAdminName() : who;
        answers[who] = await run(steps(name));
      }
      expect(answers.Kento).toEqual(answers.Nobody);
      expect(answers.Akane).toEqual(answers.Nobody);
      expect(answers.admin).toEqual(answers.Nobody);
    });
  }

  it('a correct PIN takes back only its own guess: the misses before it still count', async () => {
    await seedAll();
    for (let i = 0; i < 4; i++) await recoverAt('Kento')();
    const ok = await recover(makeRequest('POST', 'http://x/api/players/recover', { name: 'Kento', pin: '2468' }));
    expect(ok.status).toBe(200);
    // Four misses stand, as they would at a name nobody holds: the fifth is
    // free, the sixth pauses.
    expect((await read(await recoverAt('Kento')())).status).toBe(401);
    expect((await read(await recoverAt('Kento')())).status).toBe(429);
  });

  it('good sign-ins, however many, never pause anyone', async () => {
    await seedAll();
    for (let i = 0; i < 10; i++) {
      const ok = await recover(makeRequest('POST', 'http://x/api/players/recover', { name: 'Kento', pin: '2468' }));
      expect(ok.status).toBe(200);
    }
    expect((await read(await recoverAt('Kento')())).status).toBe(401);
  });
});

describe('the count stays bounded and keeps a paused name', () => {
  it('undo after other guesses landed takes back one, and the pause only below the line', () => {
    const now = Date.now();
    const mine = claimNameAttempt('Rin', now)!;
    for (let i = 0; i < FREE_ATTEMPTS; i++) claimNameAttempt('Rin', now);
    expect(nameLockSeconds('Rin', now)).toBeGreaterThan(0);
    mine.undo();
    expect(nameLockSeconds('Rin', now)).toBe(0);
  });

  it('a long name is counted by its first 64 characters', () => {
    const now = Date.now();
    const long = 'x'.repeat(5000);
    for (let i = 0; i < FREE_ATTEMPTS + 1; i++) claimNameAttempt(long + i, now);
    expect(nameLockSeconds('x'.repeat(64), now)).toBeGreaterThan(0);
  });
});
