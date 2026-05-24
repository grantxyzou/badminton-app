// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/stats/partners/route';
import { NextRequest } from 'next/server';
import { getContainer } from '@/lib/cosmos';

// Unique IP per request — partners is rate-limited 10/min; convention per helpers.ts.
function get(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'), {
    headers: { 'x-client-ip': `partners-${Math.random()}` },
  });
}

describe('GET /api/stats/partners', () => {
  beforeEach(async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    const players = getContainer('players');
    // Two sessions; Lin co-attends with Viktor twice, Carolina once.
    await players.items.upsert({ id: 'p1', sessionId: 'session-2026-05-14', name: 'Lin' });
    await players.items.upsert({ id: 'p2', sessionId: 'session-2026-05-14', name: 'Viktor' });
    await players.items.upsert({ id: 'p3', sessionId: 'session-2026-05-21', name: 'Lin' });
    await players.items.upsert({ id: 'p4', sessionId: 'session-2026-05-21', name: 'Viktor' });
    await players.items.upsert({ id: 'p5', sessionId: 'session-2026-05-21', name: 'Carolina' });
  });

  it('ranks partners by co-attendance count', async () => {
    const res = await GET(get('/api/stats/partners?name=Lin&weeks=52'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.partners[0]).toEqual({ name: 'Viktor', count: 2 });
    expect(body.partners.find((p: { name: string }) => p.name === 'Carolina').count).toBe(1);
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await GET(get('/api/stats/partners?name=Lin'));
    expect(res.status).toBe(404);
  });
});
