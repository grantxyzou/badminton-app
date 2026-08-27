import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from '../app/api/stringing/requests/route';
import { PATCH as SHOP } from '../app/api/stringing/shop/route';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
} from './helpers';
import type { StringingJob } from '../lib/types';

/**
 * A player asking for a restring.
 *
 * The route exists separately from the admin POST because that one takes the
 * member from the BODY — correct for a stringer filing a walk-up, and
 * catastrophic for a player, who could then file as anybody. These tests hold
 * that line, and the shop gate, and the fields a player may not set.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const flagBefore = process.env[FLAG];

function playerReq(name: string, body: Record<string, unknown>) {
  return makeRequest('POST', 'http://x/api/stringing/requests', body, {
    Cookie: `member_session=${memberCookieValue(name)}`,
  });
}

const VALID = {
  racketLabel: 'Astrox 99 Pro',
  stringLabel: 'BG80 white',
  tensionMains: 26,
  tensionCrosses: 28,
};

async function openShop() {
  await SHOP(makeAdminRequest('PATCH', 'http://x/api/stringing/shop', { open: true }));
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  process.env[FLAG] = 'true';
});
afterEach(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});

describe('the shop sign gates the request, on the server', () => {
  it('refuses while the shop is closed', async () => {
    const res = await POST(playerReq('wei', VALID));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('shop_closed');
  });

  it('accepts once it is open', async () => {
    await openShop();
    const res = await POST(playerReq('wei', VALID));
    expect(res.status).toBe(201);
  });

  it('refuses an anonymous caller even with the shop open', async () => {
    await openShop();
    const res = await POST(makeRequest('POST', 'http://x/api/stringing/requests', VALID));
    expect(res.status).toBe(401);
  });
});

describe('a player cannot file as somebody else', () => {
  it('ignores memberId and memberName in the body entirely', async () => {
    // The whole reason this is not the admin POST. Identity comes from the
    // cookie; the body is not consulted for it even when it insists.
    await openShop();
    const res = await POST(
      playerReq('wei', { ...VALID, memberId: 'member-priya', memberName: 'Priya' }),
    );
    expect(res.status).toBe(201);

    const stored = (getStore()['stringingJobs'] ?? []) as StringingJob[];
    expect(stored).toHaveLength(1);
    expect(stored[0].memberId).toBe('member-wei');
    expect(stored[0].memberName).toBe('wei');
  });
});

describe('a player cannot set what is not theirs to set', () => {
  it('ignores a price, a status, a stringer and a ready-by date', async () => {
    await openShop();
    await POST(
      playerReq('wei', {
        ...VALID,
        priceCents: 1,
        status: 'picked_up',
        stringerId: 'member-wei',
        readyBy: '2026-01-01',
        paidAt: '2026-01-01T00:00:00Z',
      }),
    );
    const job = ((getStore()['stringingJobs'] ?? []) as StringingJob[])[0];
    expect(job.priceCents).toBeNull();
    // `requested`, not `received`: they have not handed anything over yet.
    expect(job.status).toBe('requested');
    expect(job.stringerId).toBeNull();
    expect(job.readyBy).toBeNull();
    expect(job.paidAt).toBeNull();
  });

  it('answers with the PLAYER view, never the raw job', async () => {
    // Symmetry with GET: a create that echoed the document would hand straight
    // back the fields the read is careful to strip.
    await openShop();
    const res = await POST(playerReq('wei', VALID));
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain('priceCents');
    expect(raw).not.toContain('stringerId');
    expect(raw).not.toContain('"status"');
    expect(raw).toContain('with_stringer');
  });
});

describe('validation', () => {
  it('rejects a tension a machine cannot hold', async () => {
    await openShop();
    const res = await POST(playerReq('wei', { ...VALID, tensionMains: 40 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_tension');
  });

  it('requires a racket and a string', async () => {
    await openShop();
    for (const missing of [{ racketLabel: '' }, { stringLabel: '   ' }]) {
      const res = await POST(playerReq('wei', { ...VALID, ...missing }));
      expect(res.status).toBe(400);
    }
  });
});

describe('one player cannot bury the bench', () => {
  it('caps unfinished requests per member', async () => {
    // Bounds the SHELF, not the request rate — a stringer with forty open
    // requests from one member has a mess to sort out in person.
    await openShop();
    for (let i = 0; i < 3; i++) {
      expect((await POST(playerReq('wei', VALID))).status).toBe(201);
    }
    const res = await POST(playerReq('wei', VALID));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('too_many_open');
  });

  it('counts only UNFINISHED ones, so a regular customer is never locked out', async () => {
    await openShop();
    for (let i = 0; i < 3; i++) await POST(playerReq('wei', VALID));
    // Finish them, as the bench would.
    for (const j of (getStore()['stringingJobs'] ?? []) as StringingJob[]) j.status = 'picked_up';

    expect((await POST(playerReq('wei', VALID))).status).toBe(201);
  });

  it('counts per member, not globally', async () => {
    await openShop();
    for (let i = 0; i < 3; i++) await POST(playerReq('wei', VALID));
    expect((await POST(playerReq('priya', VALID))).status).toBe(201);
  });
});

describe('the build flag still gates it', () => {
  it('404s when off', async () => {
    await openShop();
    process.env[FLAG] = 'false';
    expect((await POST(playerReq('wei', VALID))).status).toBe(404);
  });
});
