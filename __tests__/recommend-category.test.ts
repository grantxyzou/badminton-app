import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/recommend/route';
import { makeRequest, makeGetRequest, setupAdminPin, resetMockStore } from './helpers';

describe('GET /api/recommend?category=', () => {
  beforeEach(async () => {
    resetMockStore();
    await setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER = 'true';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
    delete process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER;
  });

  it('400s on an unrecognized category rather than coercing to racket', async () => {
    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/recommend?name=Lin&category=shoes'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_category');
  });

  // R3 (controller ruling): the brief's original assertion — expect([200, 403])
  // — passes on either branch and can't fail for the reason it exists. Use the
  // admin path (bypasses the member-cookie ownership gate) and assert the
  // actual response shape instead.
  it('returns unavailable:no_engine for a valid category with no scorer', async () => {
    const res = await GET(
      makeGetRequest('http://localhost:3000/api/recommend?name=Lin&category=shoe', true),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unavailable).toBe('no_engine');
    expect(body.item).toBeNull();
  });

  it('absent category still behaves as racket', async () => {
    const res = await GET(makeRequest('GET', 'http://localhost:3000/api/recommend?name=Lin'));
    expect(res.status).not.toBe(400);
  });
});
