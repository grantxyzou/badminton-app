import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET, PATCH } from '@/app/api/stringing/pricing/route';
import { resetMockStore, seedMember, makeRequest, makeAdminRequest, setupAdminPin, seedTestAdminMember, memberCookieValue } from './helpers';

/**
 * Per-string price is the price (docs/plans/bench-redesign.md, PR 2). What is
 * left of the rate card is two fields: the price of a restring with the
 * player's OWN string, and a note players read under the prices. Both are
 * additive on the pricing doc; `services` stays stored for rollback.
 */
const BASE = 'http://localhost:3000/api/stringing/pricing';

describe('the own-string price and the note', () => {
  beforeEach(async () => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    await seedTestAdminMember();
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
  });

  it('saves them without a services list, and a member reads them back', async () => {
    const res = await PATCH(makeAdminRequest('PATCH', BASE, { ownStringCents: 1500, note: '  Prices are new this month.  ' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ services: [], ownStringCents: 1500, note: 'Prices are new this month.' });
    const lin = seedMember('Lin');
    const read = await (await GET(makeRequest('GET', BASE, undefined, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }))).json();
    expect(read).toEqual({ services: [], ownStringCents: 1500, note: 'Prices are new this month.' });
  });

  it('keeps each field the PATCH leaves out, so an older client cannot wipe them', async () => {
    await PATCH(makeAdminRequest('PATCH', BASE, { ownStringCents: 1500, note: 'Note' }));
    const svc = await (await PATCH(makeAdminRequest('PATCH', BASE, { services: [{ label: 'Labour', priceCents: 1500 }] }))).json();
    expect(svc).toEqual({ services: [{ label: 'Labour', priceCents: 1500 }], ownStringCents: 1500, note: 'Note' });
    // null is a real answer ("Ask"), and an empty note clears it.
    const cleared = await (await PATCH(makeAdminRequest('PATCH', BASE, { ownStringCents: null, note: '' }))).json();
    expect(cleared).toEqual({ services: [{ label: 'Labour', priceCents: 1500 }], ownStringCents: null, note: '' });
  });

  it('refuses a price that is not whole cents in range, and an over-long note', async () => {
    for (const ownStringCents of [-1, 12.5, '1500', 100001]) {
      expect((await PATCH(makeAdminRequest('PATCH', BASE, { ownStringCents }))).status).toBe(400);
    }
    expect((await PATCH(makeAdminRequest('PATCH', BASE, { note: 'x'.repeat(141) }))).status).toBe(400);
    expect((await PATCH(makeAdminRequest('PATCH', BASE, { note: 42 }))).status).toBe(400);
  });

  it('is admin-only to write', async () => {
    const lin = seedMember('Lin');
    const res = await PATCH(makeRequest('PATCH', BASE, { ownStringCents: 1 }, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }));
    expect(res.status).toBe(401);
  });
});
