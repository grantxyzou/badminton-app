import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMockStore, setupAdminPin, seedMember, seedMembership, seedGroup, makeRequest, memberCookieValue, getStore } from './helpers';

/**
 * Unknown is not "nobody" (CLAUDE.md, the auth twin of the lying-empty-state
 * rule). `POST /api/auth/nudge` reads its caller through `liveCallerMemberId`,
 * which re-reads the membership for the "Sign out everywhere" cutoff. When
 * that read FAILS the answer is a 503, never the 401 a signed-out phone gets,
 * and nothing is written.
 */
const outage = { on: false };
vi.mock('@/lib/groups', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/groups')>();
  return {
    ...mod,
    readMembership: async (...args: Parameters<typeof mod.readMembership>) => {
      if (outage.on) throw new Error('cosmos down');
      return mod.readMembership(...args);
    },
  };
});

import { POST as NUDGE } from '@/app/api/auth/nudge/route';

const saved = process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
let lin: { id: string };
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetMockStore();
  setupAdminPin(); // sets the cookie-signing secret
  outage.on = false;
  process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
  seedGroup('club-x', { ownerMemberId: 'someone', name: 'Six Feathers' });
  lin = seedMember('Lin');
  seedMembership('club-x', lin.id, { name: 'Lin' });
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
  else process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = saved;
  error.mockRestore();
});

const nudge = () =>
  NUDGE(
    makeRequest('POST', 'http://localhost/bpm/api/auth/nudge', undefined, {
      Cookie: `member_session=${memberCookieValue('Lin', lin.id, undefined, 'club-x')}`,
    }),
  );
const linDoc = () => ((getStore()['members'] ?? []) as Array<{ id: string; authNudge?: unknown }>).find((m) => m.id === lin.id)!;

describe('POST /api/auth/nudge when the cutoff read fails', () => {
  it('control: a live session dismisses the nudge', async () => {
    expect((await nudge()).status).toBe(200);
    expect(linDoc().authNudge).toBeDefined();
  });

  it('answers 503, not 401, and writes nothing', async () => {
    outage.on = true;
    const res = await nudge();
    expect(res.status).toBe(503);
    expect(linDoc().authNudge).toBeUndefined();
  });
});
