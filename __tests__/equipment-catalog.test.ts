// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/equipment/catalog/route';
import { NextRequest } from 'next/server';
import { getContainer } from '@/lib/cosmos';

function req(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'));
}

describe('GET /api/equipment/catalog', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
  });

  it('returns only rackets for category=racket', async () => {
    const container = getContainer('equipmentCatalog');
    // upsert (not create) — mock-store state persists across tests in a file; create would id-conflict.
    await container.items.upsert({ id: 'r1', category: 'racket', brand: 'Yonex', model: 'Astrox 88', skillRange: [3, 6] });
    await container.items.upsert({ id: 's1', category: 'string', brand: 'Yonex', model: 'BG65', skillRange: [1, 6] });

    const res = await GET(req('/api/equipment/catalog?category=racket'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.items.every((i: { category: string }) => i.category === 'racket')).toBe(true);
    expect(body.items.find((i: { id: string }) => i.id === 's1')).toBeUndefined();
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await GET(req('/api/equipment/catalog?category=racket'));
    expect(res.status).toBe(404);
  });
});
