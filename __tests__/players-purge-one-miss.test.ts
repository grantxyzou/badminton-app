import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedPlayer,
  makeAdminRequest,
  seedAdminMember,
} from './helpers';
import { DELETE } from '@/app/api/players/route';

const SESSION_ID = 'session-2026-04-05';

/**
 * A purge that finds nothing must SAY so. The raw delete used to throw a
 * Cosmos 404 here; the scoped remove() returns false instead, and a route that
 * discards that answers 200 to an admin whose row was never deleted.
 */
describe('DELETE /api/players purgeOne on a missing row', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
    seedPointer(SESSION_ID);
    seedSession(SESSION_ID);
    seedPlayer(SESSION_ID, 'Lin');
  });

  it('answers 404, not a green success', async () => {
    const res = await DELETE(
      makeAdminRequest('DELETE', 'http://localhost:3000/api/players', { purgeOne: 'no-such-id' }),
    );
    expect(res.status).toBe(404);
  });

  it('answers 404 for a row that lives in another session', async () => {
    seedSession('session-2026-03-29');
    const other = seedPlayer('session-2026-03-29', 'Viktor');
    const res = await DELETE(
      makeAdminRequest('DELETE', 'http://localhost:3000/api/players', { purgeOne: other.id }),
    );
    expect(res.status).toBe(404);
  });
});
