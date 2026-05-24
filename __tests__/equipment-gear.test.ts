// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET, PUT } from '@/app/api/equipment/gear/route';
import { NextRequest } from 'next/server';
import { getContainer } from '@/lib/cosmos';

function get(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'));
}
function put(body: unknown): NextRequest {
  return new NextRequest(new URL('/api/equipment/gear', 'http://localhost/bpm'), {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/equipment/gear', () => {
  beforeEach(async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    const members = getContainer('members');
    await members.items.upsert({ id: 'm-lin', name: 'Lin', active: true, stage: 4 });
  });

  it('PUT sets a member racket, GET reads it back', async () => {
    const putRes = await PUT(put({ name: 'Lin', item: { catalogId: 'r1', category: 'racket', label: 'Yonex Astrox 88' } }));
    expect(putRes.status).toBe(200);

    const getRes = await GET(get('/api/equipment/gear?name=Lin'));
    const body = await getRes.json();
    expect(body.gear.items).toHaveLength(1);
    expect(body.gear.items[0].label).toBe('Yonex Astrox 88');
    expect(body.gear.memberId).toBe('m-lin');
  });

  it('PUT replaces the existing racket rather than duplicating', async () => {
    await PUT(put({ name: 'Lin', item: { catalogId: 'r1', category: 'racket', label: 'Astrox 88' } }));
    await PUT(put({ name: 'Lin', item: { catalogId: 'r2', category: 'racket', label: 'Nanoflare 800' } }));
    const getRes = await GET(get('/api/equipment/gear?name=Lin'));
    const body = await getRes.json();
    const rackets = body.gear.items.filter((i: { category: string }) => i.category === 'racket');
    expect(rackets).toHaveLength(1);
    expect(rackets[0].label).toBe('Nanoflare 800');
  });

  it('GET returns empty gear for an unknown member (loaded-empty, not error)', async () => {
    const res = await GET(get('/api/equipment/gear?name=Nobody'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.gear).toBeNull();
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await GET(get('/api/equipment/gear?name=Lin'));
    expect(res.status).toBe(404);
  });
});
