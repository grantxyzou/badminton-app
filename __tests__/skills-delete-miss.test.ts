import { describe, it, expect, beforeEach } from 'vitest';
import { resetMockStore, setupAdminPin, seedPointer, seedSession, makeAdminRequest, seedAdminMember } from './helpers';
import { DELETE } from '@/app/api/skills/route';

const SESSION_ID = 'session-2026-04-05';

/** Same rule as the players purge: a delete that finds nothing answers 404. */
describe('DELETE /api/skills on a missing record', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
    seedPointer(SESSION_ID);
    seedSession(SESSION_ID);
  });

  it('answers 404, not a green success', async () => {
    const res = await DELETE(makeAdminRequest('DELETE', 'http://localhost:3000/api/skills', { id: 'no-such-id' }));
    expect(res.status).toBe(404);
  });
});
