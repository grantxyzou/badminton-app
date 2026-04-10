import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  makeRequest,
  makeAdminRequest,
  makeGetRequest,
} from './helpers';
import { GET, POST, PATCH, DELETE } from '@/app/api/skills/route';

setupAdminPin();

describe('Skills API', () => {
  beforeEach(() => {
    resetMockStore();
    seedPointer('session-2026-04-12');
    seedSession('session-2026-04-12', { title: 'Test Session' });
  });

  describe('POST /api/skills', () => {
    it('creates a record scoped to the active session', async () => {
      const res = await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'Grant',
          scores: { 'grip-stroke': 3, movement: 4, defense: 2 },
        }),
      );
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.sessionId).toBe('session-2026-04-12');
      expect(data.name).toBe('Grant');
      expect(data.scores['grip-stroke']).toBe(3);
      expect(data.updatedAt).toBeDefined();
    });

    it('upserts when (sessionId, name) already exists — no duplicates', async () => {
      await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'Grant',
          scores: { 'grip-stroke': 2 },
        }),
      );
      const res = await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'Grant',
          scores: { 'grip-stroke': 5, movement: 4 },
        }),
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.scores['grip-stroke']).toBe(5);
      expect(data.scores.movement).toBe(4);

      // Only one record in the container for this session + name
      const getRes = await GET(makeAdminRequest('GET', 'http://localhost:3000/api/skills'));
      const getData = await getRes.json();
      expect(getData.skills).toHaveLength(1);
    });

    it('upsert is case-insensitive on name', async () => {
      await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'grant',
          scores: { 'grip-stroke': 2 },
        }),
      );
      const res = await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'Grant',
          scores: { 'grip-stroke': 4 },
        }),
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.name).toBe('Grant'); // takes new casing
      expect(data.scores['grip-stroke']).toBe(4);

      const getRes = await GET(makeAdminRequest('GET', 'http://localhost:3000/api/skills'));
      const getData = await getRes.json();
      expect(getData.skills).toHaveLength(1);
    });

    it('rejects missing name', async () => {
      const res = await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          scores: { 'grip-stroke': 3 },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects scores out of 0-6 range', async () => {
      const res = await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'Grant',
          scores: { 'grip-stroke': 9 },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects non-integer scores', async () => {
      const res = await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'Grant',
          scores: { 'grip-stroke': 3.5 },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects non-admin', async () => {
      const res = await POST(
        makeRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'Grant',
          scores: { 'grip-stroke': 3 },
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/skills', () => {
    it('returns only records for the active session', async () => {
      await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'Grant',
          scores: { 'grip-stroke': 3 },
        }),
      );
      await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'Zack',
          scores: { 'grip-stroke': 4 },
        }),
      );

      const res = await GET(makeAdminRequest('GET', 'http://localhost:3000/api/skills'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.skills).toHaveLength(2);
    });

    it('isolates records across sessions', async () => {
      // POST one in current session
      await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'Grant',
          scores: { 'grip-stroke': 3 },
        }),
      );
      // Switch active session
      resetMockStore();
      seedPointer('session-2026-04-19');
      seedSession('session-2026-04-19', { title: 'Next Session' });

      const res = await GET(makeAdminRequest('GET', 'http://localhost:3000/api/skills'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.skills).toHaveLength(0);
    });

    it('rejects non-admin', async () => {
      const res = await GET(makeGetRequest('http://localhost:3000/api/skills'));
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/skills', () => {
    it('merges new scores into existing record', async () => {
      const createRes = await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'Grant',
          scores: { 'grip-stroke': 3, movement: 2 },
        }),
      );
      const { id } = await createRes.json();

      const res = await PATCH(
        makeAdminRequest('PATCH', 'http://localhost:3000/api/skills', {
          id,
          scores: { movement: 5, defense: 3 },
        }),
      );
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.scores['grip-stroke']).toBe(3); // preserved
      expect(data.scores.movement).toBe(5);        // updated
      expect(data.scores.defense).toBe(3);         // added
    });

    it('returns 404 for unknown id', async () => {
      const res = await PATCH(
        makeAdminRequest('PATCH', 'http://localhost:3000/api/skills', {
          id: 'nonexistent',
          scores: { 'grip-stroke': 4 },
        }),
      );
      expect(res.status).toBe(404);
    });

    it('rejects non-admin', async () => {
      const res = await PATCH(
        makeRequest('PATCH', 'http://localhost:3000/api/skills', {
          id: 'test',
          scores: { 'grip-stroke': 4 },
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/skills', () => {
    it('removes a record', async () => {
      const createRes = await POST(
        makeAdminRequest('POST', 'http://localhost:3000/api/skills', {
          name: 'Grant',
          scores: { 'grip-stroke': 3 },
        }),
      );
      const { id } = await createRes.json();

      const res = await DELETE(
        makeAdminRequest('DELETE', 'http://localhost:3000/api/skills', { id }),
      );
      expect(res.status).toBe(200);

      const getRes = await GET(makeAdminRequest('GET', 'http://localhost:3000/api/skills'));
      const getData = await getRes.json();
      expect(getData.skills).toHaveLength(0);
    });

    it('rejects non-admin', async () => {
      const res = await DELETE(
        makeRequest('DELETE', 'http://localhost:3000/api/skills', { id: 'test' }),
      );
      expect(res.status).toBe(401);
    });
  });
});
