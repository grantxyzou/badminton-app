// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET, PUT } from '@/app/api/equipment/gear/route';
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { setMemberCookie } from '@/lib/auth';
import { setupAdminPin, makeAdminRequest, seedAdminMember, resetMockStore } from './helpers';

function get(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'));
}
function memberCookieValue(memberId: string, name: string): string {
  const r = NextResponse.json({});
  setMemberCookie(r, memberId, name);
  return r.cookies.get('member_session')!.value;
}
/** Anonymous PUT (no member cookie). */
function put(body: unknown): NextRequest {
  return new NextRequest(new URL('/api/equipment/gear', 'http://localhost/bpm'), {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
/** PUT signed in as a given member. */
function putAs(memberId: string, name: string, body: unknown): NextRequest {
  return new NextRequest(new URL('/api/equipment/gear', 'http://localhost/bpm'), {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      cookie: `member_session=${memberCookieValue(memberId, name)}`,
    },
  });
}

const racket = { catalogId: 'r1', category: 'racket', label: 'Yonex Astrox 88' };

describe('/api/equipment/gear', () => {
  beforeEach(async () => {
    // Fix wave 2026-08: this file previously relied on test-order luck for
    // isolation (no store reset), which happened to not collide until the
    // idempotent-PUT tests were added — those legitimately re-save the same
    // racket and need a clean bag to assert bag shape against.
    resetMockStore();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    setupAdminPin();
    const members = getContainer('members');
    await members.items.upsert({ id: 'm-lin', name: 'Lin', active: true, stage: 4 });
  });

  it('PUT (as the member) sets a racket, GET reads it back', async () => {
    const putRes = await PUT(putAs('m-lin', 'Lin', { name: 'Lin', item: racket }));
    expect(putRes.status).toBe(200);

    const getRes = await GET(get('/api/equipment/gear?name=Lin'));
    const body = await getRes.json();
    expect(body.gear.items).toHaveLength(1);
    expect(body.gear.items[0].label).toBe('Yonex Astrox 88');
    expect(body.gear.memberId).toBe('m-lin');
  });

  // Closed in the same fix wave (2026-08), after the PUT append-semantics
  // change above made an invalid category no longer self-limiting: under
  // the old replace-by-category behaviour, the next save of that same bogus
  // category would just overwrite it. Appended, it's a permanent item
  // BagList can never render and nothing can delete. Mirrors the POST test.
  it('PUT rejects an item with a category outside the EquipmentCategory union', async () => {
    const res = await PUT(putAs('m-lin', 'Lin', { name: 'Lin', item: { ...racket, category: 'kitchen-sink' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_category');

    const getRes = await GET(get('/api/equipment/gear?name=Lin'));
    const body = await getRes.json();
    expect(body.gear).toBeNull();
  });

  // Fix wave 2026-08: PUT used to wipe every existing item of the same
  // category before writing. bpm-stable still runs the pre-branch client
  // (saves via PUT) while bpm-next saves via POST, and both share one Cosmos
  // DB — a stable-side save that wiped siblings would silently delete
  // rackets a next-side player had already added to the same bag.
  it('PUT preserves sibling rackets instead of replacing them', async () => {
    await PUT(putAs('m-lin', 'Lin', { name: 'Lin', item: { catalogId: 'r1', category: 'racket', label: 'Astrox 88' } }));
    await PUT(putAs('m-lin', 'Lin', { name: 'Lin', item: { catalogId: 'r2', category: 'racket', label: 'Nanoflare 800' } }));
    const getRes = await GET(get('/api/equipment/gear?name=Lin'));
    const body = await getRes.json();
    const rackets = body.gear.items.filter((i: { category: string }) => i.category === 'racket');
    expect(rackets).toHaveLength(2);
    expect(rackets.map((r: { label: string }) => r.label).sort()).toEqual(['Astrox 88', 'Nanoflare 800']);
  });

  // PUT is idempotent by contract: re-saving the exact same racket must be a
  // no-op on bag shape, not grow it or error.
  it('PUT twice with the same racket does not duplicate and does not error', async () => {
    const first = await PUT(putAs('m-lin', 'Lin', { name: 'Lin', item: racket }));
    expect(first.status).toBe(200);
    const second = await PUT(putAs('m-lin', 'Lin', { name: 'Lin', item: racket }));
    expect(second.status).toBe(200);

    const getRes = await GET(get('/api/equipment/gear?name=Lin'));
    const body = await getRes.json();
    expect(body.gear.items).toHaveLength(1);
    expect(body.gear.items[0].label).toBe('Yonex Astrox 88');
  });

  // Fix wave 2026-08 (second pass): a first draft of this fix mirrored
  // POST's "preserve the existing pointer" rule onto PUT, and this test was
  // written to pin THAT behavior — locking in a real bug (PUT A then PUT B
  // left items as [A, B] but the pointer, and the hero card, stuck on A).
  // PUT's contract is "set my racket," not "add to my bag": the incoming
  // racket must always become the active one, so the assertion below is
  // flipped from the original "pointer stays put" to "pointer follows the
  // most recent PUT."
  it('PUT always moves the pointer to the incoming racket — "set my racket," not "add to my bag"', async () => {
    const first = await PUT(putAs('m-lin', 'Lin', { name: 'Lin', item: { catalogId: 'r1', category: 'racket', label: 'Astrox 88' } }));
    const firstGear = (await first.json()).gear;
    const firstId = firstGear.items[0].id;
    expect(firstGear.activeRacketId).toBe(firstId);

    const second = await PUT(putAs('m-lin', 'Lin', { name: 'Lin', item: { catalogId: 'r2', category: 'racket', label: 'Nanoflare 800' } }));
    const secondGear = (await second.json()).gear;
    const secondId = secondGear.items.find((i: { catalogId: string }) => i.catalogId === 'r2').id;

    const getRes = await GET(get('/api/equipment/gear?name=Lin'));
    const body = await getRes.json();
    // Both rackets survive (FIX 1's append/sibling-preservation) ...
    expect(body.gear.items).toHaveLength(2);
    // ... but the pointer tracks the racket most recently PUT, not the
    // first one saved.
    expect(body.gear.activeRacketId).toBe(secondId);
    expect(body.gear.activeRacketId).not.toBe(firstId);
  });

  // Same correction as above, for the legacy-bag case: a bag with rackets
  // but no explicit pointer (activeRacket() falls back to items[0]) must
  // still have its pointer claimed by a PUT — POST's "don't steal the
  // pointer from a legacy bag" rule is specific to POST's add-to-bag
  // contract and does not apply to PUT's set-my-racket contract.
  it('PUT points at the incoming racket even into a legacy pointerless bag', async () => {
    const container = getContainer('playerGear');
    await container.items.upsert({
      id: 'gear-m-lin',
      memberId: 'm-lin',
      items: [{ id: 'legacy-1', catalogId: 'r-legacy', category: 'racket', label: 'Legacy Racket' }],
      updatedAt: new Date().toISOString(),
    });

    const res = await PUT(putAs('m-lin', 'Lin', { name: 'Lin', item: { catalogId: 'r-new', category: 'racket', label: 'New Racket' } }));
    const newId = (await res.json()).gear.items.find((i: { catalogId: string }) => i.catalogId === 'r-new').id;

    const getRes = await GET(get('/api/equipment/gear?name=Lin'));
    const body = await getRes.json();
    expect(body.gear.activeRacketId).toBe(newId);
  });

  it('rejects an anonymous PUT (no member cookie)', async () => {
    const res = await PUT(put({ name: 'Lin', item: racket }));
    expect(res.status).toBe(401);
  });

  it("rejects writing another member's gear", async () => {
    const members = getContainer('members');
    await members.items.upsert({ id: 'm-bob', name: 'Bob', active: true });
    const res = await PUT(putAs('m-bob', 'Bob', { name: 'Lin', item: racket }));
    expect(res.status).toBe(401);
  });

  it("lets an admin write on a member's behalf", async () => {
    seedAdminMember();
    const res = await PUT(
      makeAdminRequest('PUT', 'http://localhost/bpm/api/equipment/gear', { name: 'Lin', item: racket }),
    );
    expect(res.status).toBe(200);
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
