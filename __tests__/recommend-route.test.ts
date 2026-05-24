// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/recommend/route';
import { NextRequest } from 'next/server';
import { getContainer } from '@/lib/cosmos';

// Unique IP per request — recommend is rate-limited 10/min; convention per helpers.ts.
function get(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'), {
    headers: { 'x-client-ip': `rec-${Math.random()}` },
  });
}

describe('GET /api/recommend', () => {
  beforeEach(async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    const catalog = getContainer('equipmentCatalog');
    await catalog.items.upsert({ id: 'wide', category: 'racket', brand: 'Y', model: 'All-Round', skillRange: [1, 6], msrp: 120 });
    await catalog.items.upsert({ id: 'beg', category: 'racket', brand: 'Y', model: 'Starter', skillRange: [1, 2], msrp: 80 });
  });

  it('returns an all-rounder for a member with no stage', async () => {
    const members = getContainer('members');
    await members.items.upsert({ id: 'm-anon', name: 'Anon', active: true });
    const res = await GET(get('/api/recommend?name=Anon'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.item.id).toBe('wide');
    expect(typeof body.reason).toBe('string');
  });

  it('returns a stage-appropriate racket for a rated member', async () => {
    const members = getContainer('members');
    await members.items.upsert({ id: 'm-beg', name: 'Newbie', active: true, stage: 2 });
    const res = await GET(get('/api/recommend?name=Newbie'));
    const body = await res.json();
    expect(body.item.id).toBe('beg');
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await GET(get('/api/recommend?name=Anon'));
    expect(res.status).toBe(404);
  });
});
