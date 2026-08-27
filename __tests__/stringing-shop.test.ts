import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET, PATCH } from '../app/api/stringing/shop/route';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
} from './helpers';

/**
 * The shop sign.
 *
 * Distinct from `NEXT_PUBLIC_FLAG_STRINGING`, which is baked in at build time
 * and says whether this code exists. This says whether the club is taking
 * rackets this week, and changes from a phone.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const flagBefore = process.env[FLAG];

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

describe('the default is closed', () => {
  it('reads closed when nobody has ever opened it', async () => {
    // A service that has never been switched on must not advertise itself.
    const res = await GET(makeRequest('GET', 'http://x/api/stringing/shop'));
    expect(await res.json()).toEqual({ open: false });
  });
});

describe('who can read it and who can change it', () => {
  it('lets an ANONYMOUS visitor read the sign', async () => {
    // The sign is for players, and whether this club strings rackets is not a
    // secret. If only admins could read it, the audience it exists for could
    // never see it.
    const res = await GET(makeRequest('GET', 'http://x/api/stringing/shop'));
    expect(res.status).toBe(200);
  });

  it('exposes nothing but the answer', async () => {
    await PATCH(makeAdminRequest('PATCH', 'http://x/api/stringing/shop', { open: true }));
    const body = await (await GET(makeRequest('GET', 'http://x/api/stringing/shop'))).json();
    // No updatedBy, no memberId, no timestamps — a reader learns whether the
    // shop is open and nothing about who runs it.
    expect(Object.keys(body)).toEqual(['open']);
  });

  it('refuses a player trying to hang the sign', async () => {
    const res = await PATCH(
      makeRequest('PATCH', 'http://x/api/stringing/shop', { open: true }, {
        Cookie: `member_session=${memberCookieValue('wei')}`,
      }),
    );
    expect(res.status).toBe(401);
  });

  it('opens and closes for an admin', async () => {
    const open = await PATCH(makeAdminRequest('PATCH', 'http://x/api/stringing/shop', { open: true }));
    expect(await open.json()).toEqual({ open: true });
    expect((await (await GET(makeRequest('GET', 'http://x/api/stringing/shop'))).json()).open).toBe(true);

    await PATCH(makeAdminRequest('PATCH', 'http://x/api/stringing/shop', { open: false }));
    expect((await (await GET(makeRequest('GET', 'http://x/api/stringing/shop'))).json()).open).toBe(false);
  });

  it('rejects anything that is not a boolean', async () => {
    for (const open of ['true', 1, null, undefined]) {
      const res = await PATCH(makeAdminRequest('PATCH', 'http://x/api/stringing/shop', { open }));
      expect(res.status).toBe(400);
    }
  });
});

describe('the sign lives outside the job container', () => {
  it('does not appear as a job on the bench', async () => {
    // The bench lists jobs with `SELECT * FROM c`. A settings document in that
    // container would come back as a job with no name, no racket and no status
    // — the trap the birds container already carries with its adjustment docs.
    await PATCH(makeAdminRequest('PATCH', 'http://x/api/stringing/shop', { open: true }));
    expect(getStore()['stringingJobs'] ?? []).toHaveLength(0);
    expect(getStore()['clubSettings'] ?? []).toHaveLength(1);
  });

  it('keeps one document however many times it is toggled', async () => {
    for (const open of [true, false, true, false]) {
      await PATCH(makeAdminRequest('PATCH', 'http://x/api/stringing/shop', { open }));
    }
    expect(getStore()['clubSettings']).toHaveLength(1);
  });
});

describe('the build flag still gates it', () => {
  it('404s both verbs when off', async () => {
    process.env[FLAG] = 'false';
    const get = await GET(makeRequest('GET', 'http://x/api/stringing/shop'));
    const patch = await PATCH(makeAdminRequest('PATCH', 'http://x/api/stringing/shop', { open: true }));
    expect([get.status, patch.status]).toEqual([404, 404]);
  });
});
