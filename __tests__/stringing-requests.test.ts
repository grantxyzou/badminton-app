import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from '../app/api/stringing/requests/route';
import { PATCH as SHOP } from '../app/api/stringing/shop/route';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedMember,
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

/** The player must exist as an ACTIVE member: the route re-reads the
 *  membership, so a cookie for nobody is a 401, not a requester. */
function playerReq(name: string, body: Record<string, unknown>) {
  const rows = (getStore()['members'] ?? []) as Array<{ name?: string; active?: boolean }>;
  if (!rows.some((m) => m.name === name && m.active !== false)) seedMember(name);
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
    const wei = (getStore()['members'] as { id: string; name: string }[]).find((m) => m.name === 'wei')!;
    expect(stored[0].memberId).toBe(wei.id);
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
    // A fresh request is its own player stage: the racket is still in the bag.
    expect(raw).toContain('"stage":"awaiting_dropoff"');
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

  it('does not count ARCHIVED jobs, so tidying the bench cannot lock someone out', async () => {
    // An abandoned job sits at an unfinished status forever — the racket was
    // collected in person, nobody moved it along. Archiving is how a stringer
    // clears that. If the cap still counted it, the member would be blocked by
    // a job they cannot see and cannot act on.
    await openShop();
    for (let i = 0; i < 3; i++) await POST(playerReq('wei', VALID));
    expect((await POST(playerReq('wei', VALID))).status).toBe(409);

    for (const j of (getStore()['stringingJobs'] ?? []) as StringingJob[]) {
      j.archivedAt = '2026-09-01T00:00:00.000Z';
    }
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

/**
 * The colour a player picks (docs/design/strings-shelf-spec.md). A SEPARATE
 * field, never folded into the label: stock matches a job to its reel by
 * `labelKey(stringLabel)`, and "BG80 · Yellow" would match nothing.
 */
describe('stringColor', () => {
  const jobs = () => getStore()['stringingJobs'] as StringingJob[];

  it('is optional', async () => {
    await openShop();
    const res = await POST(playerReq('wei', VALID));
    expect(res.status).toBe(201);
    expect(jobs()[0].stringColor).toBeUndefined();
  });

  it('is trimmed, stored apart from the label, and reaches the player view', async () => {
    await openShop();
    const res = await POST(playerReq('wei', { ...VALID, stringColor: '  Yellow ' }));
    expect(res.status).toBe(201);
    expect(jobs()[0]).toMatchObject({ stringLabel: 'BG80 white', stringColor: 'Yellow', priceCents: null });
    expect((await res.json()).job.stringColor).toBe('Yellow');
  });

  it('drops a colour that is too long or not a string, and still files the request', async () => {
    await openShop();
    expect((await POST(playerReq('wei', { ...VALID, stringColor: 'x'.repeat(31) }))).status).toBe(201);
    expect((await POST(playerReq('wei', { ...VALID, stringColor: 42 }))).status).toBe(201);
    expect(jobs().map((j) => j.stringColor)).toEqual([undefined, undefined]);
  });

  it('keeps 30 characters', async () => {
    await openShop();
    await POST(playerReq('wei', { ...VALID, stringColor: 'x'.repeat(30) }));
    expect(jobs()[0].stringColor).toBe('x'.repeat(30));
  });
});
