import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { POST, GET } from '../app/api/equipment/gear/route';
import { resetMockStore, setupAdminPin, seedMember, makeRequest, memberCookieValue } from './helpers';

const URL = 'http://localhost:3000/api/equipment/gear';

function addAs(name: string, item: Record<string, unknown>) {
  return makeRequest('POST', URL, { name, item }, {
    Cookie: `member_session=${memberCookieValue(name)}`,
  });
}

async function itemsFor(name: string) {
  const res = await GET(makeRequest('GET', `${URL}?name=${encodeURIComponent(name)}`));
  const body = await res.json();
  return (body?.gear?.items ?? []) as { category?: string; label: string }[];
}

describe('gear — string selection', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    seedMember('Lin', { id: 'member-lin' });
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
  });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
  });

  it('accepts a string and stores its category', async () => {
    const res = await POST(addAs('Lin', { catalogId: 'string-yx-bg65', category: 'string', label: 'Yonex BG65' }));
    expect(res.status).toBe(200);
    const items = await itemsFor('Lin');
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe('string');
    expect(items[0].label).toBe('Yonex BG65');
  });

  it('keeps a racket and a string side by side', async () => {
    await POST(addAs('Lin', { catalogId: 'racket-a', category: 'racket', label: 'Astrox 88D' }));
    await POST(addAs('Lin', { catalogId: 'string-yx-bg65', category: 'string', label: 'Yonex BG65' }));
    const items = await itemsFor('Lin');
    expect(items.map((i) => i.category).sort()).toEqual(['racket', 'string']);
  });

  it('rejects a category outside the union', async () => {
    const res = await POST(addAs('Lin', { catalogId: 'x', category: 'nonsense', label: 'X' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_category');
  });

  it('dedupes a string by catalogId', async () => {
    await POST(addAs('Lin', { catalogId: 'string-yx-bg65', category: 'string', label: 'Yonex BG65' }));
    const res = await POST(addAs('Lin', { catalogId: 'string-yx-bg65', category: 'string', label: 'Yonex BG65' }));
    expect(res.status).toBe(409);
  });

  // ── The per-category cap ────────────────────────────────────────────────
  it('caps strings, which used to be UNCAPPED because the limit counted rackets', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await POST(addAs('Lin', { catalogId: `string-${i}`, category: 'string', label: `S${i}` }));
      expect(res.status).toBe(200);
    }
    const overflow = await POST(addAs('Lin', { catalogId: 'string-6', category: 'string', label: 'S6' }));
    expect(overflow.status).toBe(409);
    expect((await overflow.json()).error).toBe('bag_full');
  });

  it('counts the cap per category — a full string shelf does not block a racket', async () => {
    for (let i = 0; i < 5; i += 1) {
      await POST(addAs('Lin', { catalogId: `string-${i}`, category: 'string', label: `S${i}` }));
    }
    const racket = await POST(addAs('Lin', { catalogId: 'racket-a', category: 'racket', label: 'Astrox' }));
    expect(racket.status).toBe(200);
  });

  it('leaves the racket limit at its existing 10', async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await POST(addAs('Lin', { catalogId: `racket-${i}`, category: 'racket', label: `R${i}` }));
      expect(res.status).toBe(200);
    }
    const overflow = await POST(addAs('Lin', { catalogId: 'racket-11', category: 'racket', label: 'R11' }));
    expect(overflow.status).toBe(409);
  });

  // ── The active pointer stays racket-only ────────────────────────────────
  it('does not let a string claim the active-racket pointer', async () => {
    await POST(addAs('Lin', { catalogId: 'string-yx-bg65', category: 'string', label: 'Yonex BG65' }));
    const res = await GET(makeRequest('GET', `${URL}?name=Lin`));
    const body = await res.json();
    // activeRacketId means "which racket am I playing with" — a string must
    // never end up there, or activeRacket() resolves to a spool of string.
    expect(body?.gear?.activeRacketId).toBeUndefined();
  });

  it('still claims the pointer for a first racket', async () => {
    await POST(addAs('Lin', { catalogId: 'string-yx-bg65', category: 'string', label: 'Yonex BG65' }));
    await POST(addAs('Lin', { catalogId: 'racket-a', category: 'racket', label: 'Astrox' }));
    const res = await GET(makeRequest('GET', `${URL}?name=Lin`));
    const body = await res.json();
    expect(body?.gear?.activeRacketId).toBeTruthy();
  });

  it('still requires the member cookie', async () => {
    const res = await POST(
      makeRequest('POST', URL, { name: 'Lin', item: { catalogId: 'x', category: 'string', label: 'X' } }),
    );
    expect(res.status).toBe(401);
  });
});
