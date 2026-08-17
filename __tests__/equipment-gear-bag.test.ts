import { describe, it, expect, beforeEach } from 'vitest';
import { POST, PATCH, DELETE, GET } from '../app/api/equipment/gear/route';
import {
  resetMockStore, seedMember, memberCookieValue, makeRequest, makeGetRequest, setupAdminPin,
  getStore, makeAdminRequest, seedAdminMember,
} from './helpers';
import { activeRacket } from '../lib/activeRacket';
import type { PlayerGear } from '../lib/types';

const NAME = 'Lin';
const MEMBER_ID = 'member-lin';
const OTHER_NAME = 'Viktor';
const OTHER_MEMBER_ID = 'member-viktor';

// NOTE the argument order: makeRequest(method, url, body, headers) — method
// first. And memberCookieValue returns the bare cookie VALUE, so it must be
// prefixed with `member_session=`. makeRequest already assigns a unique
// X-Client-IP per call, so tests never need to set one by hand.
function bagRequest(method: string, body?: Record<string, unknown>) {
  return makeRequest(method, 'http://localhost/api/equipment/gear', body, {
    Cookie: `member_session=${memberCookieValue(NAME, MEMBER_ID)}`,
  });
}

function unauthedRequest(method: string, body?: Record<string, unknown>) {
  return makeRequest(method, 'http://localhost/api/equipment/gear', body);
}

async function readGear(): Promise<PlayerGear | null> {
  const res = await GET(makeGetRequest(`http://localhost/api/equipment/gear?name=${NAME}`));
  return (await res.json()).gear;
}

const RACKET_A = { catalogId: 'racket-yonex-astrox-100zz', category: 'racket', label: 'Yonex Astrox 100ZZ' };
const RACKET_B = { catalogId: 'racket-victor-drivex-9x', category: 'racket', label: 'Victor DriveX 9X' };

beforeEach(() => {
  resetMockStore();
  setupAdminPin(); // sets SESSION_SECRET so member_session cookies sign/verify deterministically
  seedMember(NAME, { id: MEMBER_ID });
  seedMember(OTHER_NAME, { id: OTHER_MEMBER_ID });
  process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
});

// A caller authenticated as a DIFFERENT member — the impersonation case this
// endpoint's auth exists to prevent. Member names are enumerable, so
// name-only access would be a takeover hole.
function otherMemberRequest(method: string, body?: Record<string, unknown>) {
  return makeRequest(method, 'http://localhost/api/equipment/gear', body, {
    Cookie: `member_session=${memberCookieValue(OTHER_NAME, OTHER_MEMBER_ID)}`,
  });
}

function deleteRequest(itemId: string) {
  return makeRequest('DELETE', `http://localhost/api/equipment/gear?name=${NAME}&itemId=${itemId}`,
    undefined, { Cookie: `member_session=${memberCookieValue(NAME, MEMBER_ID)}` });
}

describe('POST /api/equipment/gear', () => {
  it('appends without discarding the previous racket', async () => {
    await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    await POST(bagRequest('POST', { name: NAME, item: RACKET_B }));
    const gear = await readGear();
    expect(gear?.items).toHaveLength(2);
  });

  it('points at the first racket added, and does not move the pointer after', async () => {
    const first = await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const pointer = ((await first.json()).gear as PlayerGear).activeRacketId;
    expect(pointer).toBeTruthy();
    await POST(bagRequest('POST', { name: NAME, item: RACKET_B }));
    expect((await readGear())?.activeRacketId).toBe(pointer);
  });

  it('rejects a racket already in the bag', async () => {
    await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const res = await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('duplicate_racket');
  });

  it('caps the bag at 10', async () => {
    for (let i = 0; i < 10; i += 1) {
      await POST(bagRequest('POST', { name: NAME, item: { ...RACKET_A, catalogId: `racket-${i}`, label: `R${i}` } }));
    }
    const res = await POST(bagRequest('POST', { name: NAME, item: RACKET_B }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('bag_full');
  });

  // Fix wave 2026-08: an unvalidated category bypassed MAX_RACKETS (which
  // only counts rackets()) and produced an item BagList never renders — no
  // delete affordance, and it wrote an arbitrary string into a field typed
  // EquipmentCategory.
  it('rejects an item with a category outside the EquipmentCategory union', async () => {
    const res = await POST(bagRequest('POST', { name: NAME, item: { ...RACKET_A, category: 'kitchen-sink' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_category');
    expect(await readGear()).toBeNull();
  });

  it('rejects a caller without the member cookie', async () => {
    const res = await POST(unauthedRequest('POST', { name: NAME, item: RACKET_A }));
    expect(res.status).toBe(401);
  });

  it('rejects a caller authenticated as a different member', async () => {
    const res = await POST(otherMemberRequest('POST', { name: NAME, item: RACKET_A }));
    expect(res.status).toBe(401);
  });

  it('allows an admin to add gear for a member they do not own', async () => {
    seedAdminMember();
    const res = await POST(makeAdminRequest('POST', 'http://localhost/api/equipment/gear', { name: NAME, item: RACKET_A }));
    expect(res.status).toBe(200);
    expect((await readGear())?.items).toHaveLength(1);
  });

  // Task 7's activeRacket() resolver treats a bag with rackets but no
  // explicit pointer as "the first racket is active" (the legacy-document
  // contract). Appending to such a bag must not silently move the pointer
  // onto the newly-added racket, even though prior?.activeRacketId reads as
  // undefined for both a legacy bag and a genuinely-empty one.
  it('does not steal the pointer when appending to a legacy bag with no explicit pointer', async () => {
    const store = getStore();
    store['playerGear'] = [
      {
        id: `gear-${MEMBER_ID}`,
        memberId: MEMBER_ID,
        items: [
          { id: 'legacy-1', catalogId: 'racket-legacy-1', category: 'racket', label: 'Legacy One' },
          { id: 'legacy-2', catalogId: 'racket-legacy-2', category: 'racket', label: 'Legacy Two' },
        ],
        updatedAt: new Date().toISOString(),
        // no activeRacketId — legacy contract
      },
    ];
    await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const gear = await readGear();
    expect(gear?.activeRacketId).toBeUndefined();
    expect(activeRacket(gear)?.id).toBe('legacy-1');
  });

  it('rejects a duplicate free-text racket by label when catalogId is absent', async () => {
    const freeText = { category: 'racket', label: 'My Old Racket' };
    await POST(bagRequest('POST', { name: NAME, item: freeText }));
    const res = await POST(bagRequest('POST', { name: NAME, item: freeText }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('duplicate_racket');
  });

  // The limiter is keyed on name+IP and is module-level in-memory state that
  // resetMockStore() does NOT clear. Every other test here gets a unique IP
  // from makeRequest and so never trips it; this one pins a dedicated IP that
  // no other test uses, so the count is its own.
  it('rate-limits a flood of bag writes from one IP', async () => {
    const pinned = { Cookie: `member_session=${memberCookieValue(NAME, MEMBER_ID)}`, 'X-Client-IP': '203.0.113.77' };
    let last = 200;
    for (let i = 0; i < 22; i += 1) {
      const res = await POST(makeRequest('POST', 'http://localhost/api/equipment/gear',
        { name: NAME, item: { ...RACKET_A, catalogId: `racket-flood-${i}`, label: `F${i}` } }, pinned));
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

describe('PATCH /api/equipment/gear', () => {
  it('moves the pointer', async () => {
    await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const second = await POST(bagRequest('POST', { name: NAME, item: RACKET_B }));
    const target = ((await second.json()).gear as PlayerGear).items[1].id;
    await PATCH(bagRequest('PATCH', { name: NAME, activeRacketId: target }));
    expect((await readGear())?.activeRacketId).toBe(target);
  });

  it('404s on an id that is not in the bag', async () => {
    await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const res = await PATCH(bagRequest('PATCH', { name: NAME, activeRacketId: 'nope' }));
    expect(res.status).toBe(404);
  });

  it('rejects a caller without the member cookie', async () => {
    const res = await PATCH(unauthedRequest('PATCH', { name: NAME, activeRacketId: 'x' }));
    expect(res.status).toBe(401);
  });

  it('rejects a caller authenticated as a different member', async () => {
    await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const res = await PATCH(otherMemberRequest('PATCH', { name: NAME, activeRacketId: 'x' }));
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/equipment/gear', () => {
  it('removes one racket and leaves the rest', async () => {
    const first = await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    await POST(bagRequest('POST', { name: NAME, item: RACKET_B }));
    const targetId = ((await first.json()).gear as PlayerGear).items[0].id;
    await DELETE(deleteRequest(targetId));
    const gear = await readGear();
    expect(gear?.items).toHaveLength(1);
    expect(gear?.items[0].label).toBe(RACKET_B.label);
  });

  it('repoints when the active racket is removed', async () => {
    const first = await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    await POST(bagRequest('POST', { name: NAME, item: RACKET_B }));
    const activeId = ((await first.json()).gear as PlayerGear).items[0].id;
    await DELETE(deleteRequest(activeId));
    const gear = await readGear();
    expect(gear?.activeRacketId).toBe(gear?.items[0].id);
  });

  it('clears the pointer when the last racket goes', async () => {
    const first = await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const onlyId = ((await first.json()).gear as PlayerGear).items[0].id;
    await DELETE(deleteRequest(onlyId));
    const gear = await readGear();
    expect(gear?.items).toHaveLength(0);
    expect(gear?.activeRacketId).toBeUndefined();
  });

  it('rejects a caller authenticated as a different member', async () => {
    const first = await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const targetId = ((await first.json()).gear as PlayerGear).items[0].id;
    const res = await DELETE(makeRequest('DELETE', `http://localhost/api/equipment/gear?name=${NAME}&itemId=${targetId}`,
      undefined, { Cookie: `member_session=${memberCookieValue(OTHER_NAME, OTHER_MEMBER_ID)}` }));
    expect(res.status).toBe(401);
  });
});
