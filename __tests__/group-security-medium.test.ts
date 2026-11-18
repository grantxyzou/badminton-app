import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST as postGame } from '@/app/api/games/route';
import { PATCH as patchPlayer } from '@/app/api/players/route';
import {
  resetMockStore,
  getStore,
  seedDoc,
  seedSession,
  seedMember,
  seedGroup,
  seedMembership,
  makeRequest,
  setupAdminPin,
  memberCookieValue,
} from './helpers';

/**
 * Claude Security scan, 2026-11-17, the MEDIUM findings that are one route
 * each. F5: logging a game is acting INSIDE the club, so the recorder must be
 * on its roster, not merely signed in. F10: an anonymous PIN write must not
 * buy a scrypt, and a fresh name must not buy a fresh allowance.
 */

const hashes = { count: 0 };
vi.mock('@/lib/recoveryHash', async (orig) => {
  const mod = await orig<typeof import('@/lib/recoveryHash')>();
  return {
    ...mod,
    hashPin: async (pin: string) => {
      hashes.count++;
      return mod.hashPin(pin);
    },
  };
});

const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const BPM = 'bpm';
const SESSION = 'session-2026-11-20';

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env[FLAG] = 'true';
  hashes.count = 0;
  seedGroup(BPM, { name: 'BPM Core' });
  seedSession(SESSION);
  seedDoc('sessions', { id: 'active-session-pointer', sessionId: 'active-session-pointer', activeSessionId: SESSION });
});
afterEach(() => {
  delete process.env[FLAG];
});

const game = { teamA: ['Lin', 'Viktor'], teamB: ['Carolina', 'Akane'], scoreA: 21, scoreB: 18 };

describe('F5: POST /api/games needs a place on the club’s roster', () => {
  it('refuses an account in no club whose cookie names BPM', async () => {
    seedMember('Stranger', { id: 'stranger' });
    const res = await postGame(makeRequest('POST', 'http://x/api/games', game, {
      Cookie: `member_session=${memberCookieValue('Stranger', 'stranger')}`,
    }));
    expect(res.status).toBe(401);
    expect(getStore()['gameResults'] ?? []).toHaveLength(0);
  });

  it('takes a game from a member on the roster, logged under their roster name', async () => {
    seedMember('Lin Dan', { id: 'lin' });
    seedMembership(BPM, 'lin', { name: 'Lin' });
    const res = await postGame(makeRequest('POST', 'http://x/api/games', game, {
      Cookie: `member_session=${memberCookieValue('Lin', 'lin')}`,
    }));
    expect(res.status).toBe(201);
    expect((getStore()['gameResults'] as Array<{ loggedBy: string }>)[0].loggedBy).toBe('Lin');
  });
});

describe('F10: PATCH /api/players with a PIN', () => {
  it('an anonymous request is refused before any PIN is hashed', async () => {
    const res = await patchPlayer(makeRequest('PATCH', 'http://x/api/players', { name: 'Anyone', pin: '5839' }));
    expect([401, 404]).toContain(res.status);
    expect(hashes.count).toBe(0);
  });

  it('a fresh name per request does not buy a fresh allowance from one address', async () => {
    const ip = { 'X-Client-IP': 'f10-one-address' };
    const answers: number[] = [];
    for (let i = 0; i < 25; i++) {
      const res = await patchPlayer(makeRequest('PATCH', 'http://x/api/players', { name: `Name ${i}`, pin: '5839' }, ip));
      answers.push(res.status);
    }
    expect(answers.slice(20)).toEqual([429, 429, 429, 429, 429]);
  });
});
