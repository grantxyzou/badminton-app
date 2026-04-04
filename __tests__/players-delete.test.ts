import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedPlayer,
  makeRequest,
  makeAdminRequest,
} from './helpers';
import { DELETE } from '@/app/api/players/route';

// The DELETE route uses Buffer.from(str) (UTF-8), not Buffer.from(str, 'hex').
// Any string works as long as the stored token and the submitted token are identical
// in value AND length (timingSafeEqual requires equal byte lengths).
// We use a 32-char repeating string — easy to read and unambiguous.
const VALID_TOKEN = 'a'.repeat(32);
const SESSION_ID = 'session-2026-04-05';

describe('DELETE /api/players', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedPointer(SESSION_ID);
    seedSession(SESSION_ID);
  });

  // ── SELF-CANCEL (non-admin) ─────────────────────────────────────────────────

  describe('self-cancel (non-admin)', () => {
    it('returns 200 and soft-deletes the player when name + token match', async () => {
      // ARRANGE: seed a player with a known deleteToken
      const player = seedPlayer(SESSION_ID, 'Alice', { deleteToken: VALID_TOKEN });

      // ACT: send a DELETE with the correct name and token
      const req = makeRequest('DELETE', 'http://localhost:3000/api/players', {
        name: 'Alice',
        deleteToken: VALID_TOKEN,
      });
      const res = await DELETE(req);
      const data = await res.json();

      // ASSERT: route returns success
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      // ASSERT: player is soft-deleted in the store — removed flag is set
      const store = global._mockStore as Record<string, Record<string, unknown>[]>;
      const stored = store['players'].find((p) => p.id === player.id);
      expect(stored?.removed).toBe(true);
      expect(stored?.cancelledBySelf).toBe(true);
      expect(stored?.removedAt).toBeDefined();
    });

    it('returns 401 when the token does not match', async () => {
      // ARRANGE: seed a player with a known token, then submit the wrong one
      seedPlayer(SESSION_ID, 'Alice', { deleteToken: VALID_TOKEN });
      const wrongToken = 'b'.repeat(32); // same length, different value

      // ACT
      const req = makeRequest('DELETE', 'http://localhost:3000/api/players', {
        name: 'Alice',
        deleteToken: wrongToken,
      });
      const res = await DELETE(req);
      const data = await res.json();

      // ASSERT
      expect(res.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('returns 401 when no token is provided and the caller is not an admin', async () => {
      // ARRANGE: seed a player
      seedPlayer(SESSION_ID, 'Alice', { deleteToken: VALID_TOKEN });

      // ACT: omit deleteToken entirely — not admin, so this must be rejected
      const req = makeRequest('DELETE', 'http://localhost:3000/api/players', {
        name: 'Alice',
      });
      const res = await DELETE(req);
      const data = await res.json();

      // ASSERT: missing token with no admin cookie → 401
      expect(res.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('returns 404 when the named player does not exist in the session', async () => {
      // ARRANGE: store is empty — no players seeded

      // ACT: try to cancel a player that was never signed up
      const req = makeRequest('DELETE', 'http://localhost:3000/api/players', {
        name: 'Ghost',
        deleteToken: VALID_TOKEN,
      });
      const res = await DELETE(req);
      const data = await res.json();

      // ASSERT
      expect(res.status).toBe(404);
      expect(data.error).toBe('Player not found');
    });
  });

  // ── ADMIN OPERATIONS ────────────────────────────────────────────────────────

  describe('admin operations', () => {
    it('purgeAll hard-deletes every player record for the session', async () => {
      // ARRANGE: seed multiple players
      seedPlayer(SESSION_ID, 'Alice', { deleteToken: VALID_TOKEN });
      seedPlayer(SESSION_ID, 'Bob', { deleteToken: VALID_TOKEN });
      seedPlayer(SESSION_ID, 'Charlie', { deleteToken: VALID_TOKEN });

      // ACT: admin requests a full hard purge
      const req = makeAdminRequest('DELETE', 'http://localhost:3000/api/players', {
        name: 'admin',
        purgeAll: true,
      });
      const res = await DELETE(req);
      const data = await res.json();

      // ASSERT: route confirms deletion
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.count).toBe(3);

      // ASSERT: store has no remaining player records for the session
      const store = global._mockStore as Record<string, Record<string, unknown>[]>;
      const remaining = (store['players'] ?? []).filter((p) => p.sessionId === SESSION_ID);
      expect(remaining).toHaveLength(0);
    });

    it('clearAll soft-deletes all active players without destroying records', async () => {
      // ARRANGE: seed a mix of active and already-removed players
      seedPlayer(SESSION_ID, 'Alice', { deleteToken: VALID_TOKEN });
      seedPlayer(SESSION_ID, 'Bob', { deleteToken: VALID_TOKEN });
      // Charlie is already removed — should not be touched by clearAll
      seedPlayer(SESSION_ID, 'Charlie', { deleteToken: VALID_TOKEN, removed: true });

      // ACT: admin requests a soft clear
      const req = makeAdminRequest('DELETE', 'http://localhost:3000/api/players', {
        name: 'admin',
        clearAll: true,
      });
      const res = await DELETE(req);
      const data = await res.json();

      // ASSERT: only the two active players were cleared
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.count).toBe(2);

      // ASSERT: every player in the store now has removed: true
      const store = global._mockStore as Record<string, Record<string, unknown>[]>;
      const players = (store['players'] ?? []).filter((p) => p.sessionId === SESSION_ID);
      expect(players.every((p) => p.removed === true)).toBe(true);
    });

    it('returns 400 when name is missing from a plain admin delete', async () => {
      // ARRANGE: nothing extra needed — the route validates name before hitting the DB

      // ACT: admin sends a body with no name and no bulk operation flag
      const req = makeAdminRequest('DELETE', 'http://localhost:3000/api/players', {});
      const res = await DELETE(req);
      const data = await res.json();

      // ASSERT
      expect(res.status).toBe(400);
      expect(data.error).toBe('Name required');
    });
  });
});
