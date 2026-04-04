import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedPlayer,
  makeRequest,
  getStore,
} from './helpers';
import { PATCH } from '@/app/api/players/route';

const TOKEN = 'a'.repeat(32);

describe('PATCH /api/players (self-serve "I paid")', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedPointer('session-2026-04-05');
    seedSession('session-2026-04-05');
  });

  it('sets selfReportedPaid when token matches', async () => {
    const player = seedPlayer('session-2026-04-05', 'Alice', { deleteToken: TOKEN });

    const res = await PATCH(makeRequest('PATCH', 'http://localhost:3000/api/players', {
      id: player.id,
      deleteToken: TOKEN,
      selfReportedPaid: true,
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.selfReportedPaid).toBe(true);
    expect(data.deleteToken).toBeUndefined(); // token must not leak
  });

  it('returns 401 when token does not match', async () => {
    const player = seedPlayer('session-2026-04-05', 'Bob', { deleteToken: TOKEN });

    const res = await PATCH(makeRequest('PATCH', 'http://localhost:3000/api/players', {
      id: player.id,
      deleteToken: 'b'.repeat(32),
      selfReportedPaid: true,
    }));

    expect(res.status).toBe(401);
  });

  it('returns 404 when player does not exist', async () => {
    const res = await PATCH(makeRequest('PATCH', 'http://localhost:3000/api/players', {
      id: 'nonexistent',
      deleteToken: TOKEN,
      selfReportedPaid: true,
    }));

    expect(res.status).toBe(404);
  });

  it('returns 401 when no token is provided (non-admin)', async () => {
    const player = seedPlayer('session-2026-04-05', 'Charlie', { deleteToken: TOKEN });

    const res = await PATCH(makeRequest('PATCH', 'http://localhost:3000/api/players', {
      id: player.id,
      selfReportedPaid: true,
    }));

    expect(res.status).toBe(401);
  });
});
