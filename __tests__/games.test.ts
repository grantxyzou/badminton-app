// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/games/route';
import { NextRequest } from 'next/server';
import { resetMockStore, seedPointer, setupAdminPin, makeAdminRequest } from './helpers';

function get(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'));
}
function post(body: unknown): NextRequest {
  return new NextRequest(new URL('/api/games', 'http://localhost/bpm'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-client-ip': `games-${Math.random()}` },
  });
}

const validGame = {
  sessionId: 'session-2026-05-21',
  teamA: ['Lin', 'Viktor'],
  teamB: ['Carolina', 'Akane'],
  scoreA: 21,
  scoreB: 18,
  loggedBy: 'Lin',
};

describe('/api/games', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
  });

  it('POST logs a full-doubles result, GET lists it for the session', async () => {
    const postRes = await POST(post(validGame));
    expect(postRes.status).toBe(201);

    const getRes = await GET(get('/api/games?sessionId=session-2026-05-21'));
    const body = await getRes.json();
    expect(body.games.length).toBeGreaterThanOrEqual(1);
    const mine = body.games.find((g: { loggedBy: string }) => g.loggedBy === 'Lin');
    expect(mine.teamA).toEqual(['Lin', 'Viktor']);
    expect(mine.scoreA).toBe(21);
  });

  it('rejects a result missing a team', async () => {
    const res = await POST(post({ ...validGame, teamB: [] }));
    expect(res.status).toBe(400);
  });

  it('rejects non-numeric scores', async () => {
    const res = await POST(post({ ...validGame, scoreA: 'lots' }));
    expect(res.status).toBe(400);
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await POST(post(validGame));
    expect(res.status).toBe(404);
  });
});

describe('/api/games — sessionId override is admin-only (rule 7)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    setupAdminPin();
    resetMockStore();
    seedPointer('session-active');
  });

  it('ignores a client sessionId override on an anonymous POST (writes to the active session)', async () => {
    const res = await POST(post({ ...validGame, sessionId: 'session-evil' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.sessionId).toBe('session-active');
  });

  it('honors the sessionId override for an admin POST', async () => {
    const res = await POST(
      makeAdminRequest('POST', 'http://localhost/bpm/api/games', { ...validGame, sessionId: 'session-archive' }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.sessionId).toBe('session-archive');
  });

  it('ignores a ?sessionId= override on an anonymous GET (reads the active session)', async () => {
    // Log into the active session, then a foreign read attempt must not surface it
    // under the foreign id — the anon GET resolves to the active session regardless.
    await POST(post({ ...validGame, sessionId: 'session-evil' }));
    const res = await GET(get('/api/games?sessionId=session-evil'));
    const body = await res.json();
    expect(body.games.every((g: { sessionId: string }) => g.sessionId === 'session-active')).toBe(true);
  });
});
