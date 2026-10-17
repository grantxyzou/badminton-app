import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/players/route';
import {
  resetMockStore,
  seedPointer,
  seedSession,
  seedMember,
  setupAdminPin,
  seedTestAdminMember,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
  getStore,
} from './helpers';
import { verifyPin } from '@/lib/recoveryHash';

const SESSION = 'session-2026-04-30';
const URL_PATH = 'http://localhost:3000/api/players';

/**
 * MEMBERS ONLY (permanent): a non-admin caller must be a signed-in ACTIVE
 * member, and the name comes from that account — the body's `name` is ignored.
 * So every non-admin case here carries the member's own `member_session`.
 */
function cookieFor(member: { id: string; name: string }) {
  return { Cookie: `member_session=${memberCookieValue(member.name, member.id)}` };
}

const membersNamed = (name: string) =>
  ((getStore()['members'] ?? []) as Array<{ name: string; pinHash?: string }>).filter((m) => m.name === name);

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  seedPointer(SESSION);
  seedSession(SESSION);
  // Admin mutations on this route re-read the Member doc (role + active).
  await seedTestAdminMember();
});

describe('POST /api/players { sessionSignup: false } — account-only path', () => {
  it('creates a member with pinHash, no session player', async () => {
    const member = seedMember('Riley'); // pre-seeded by admin (invite-only flow)
    // Claiming an invited name needs proof it is yours — here the cookie this
    // device was minted at sign-up. See the claim-gate cases below.
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Riley', pin: '4827', sessionSignup: false }, {
        Cookie: `member_session=${memberCookieValue('Riley', member.id)}`,
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe('Riley');
    expect(data.deleteToken).toBeNull();
    expect(typeof data.id).toBe('string');

    const store = getStore();
    const members = (store['members'] ?? []) as Array<{ name: string; pinHash?: string }>;
    expect(members.find((m) => m.name === 'Riley')?.pinHash).toBeDefined();
    expect(store['players'] ?? []).toHaveLength(0);
  });

  it('PIN is required — 400 when omitted', async () => {
    const riley = seedMember('Riley');
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Riley', sessionSignup: false }, cookieFor(riley)),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/PIN required/);
  });

  it('rejects blocklisted PINs', async () => {
    const riley = seedMember('Riley');
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Riley', pin: '1234', sessionSignup: false }, cookieFor(riley)),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('pin_too_common');
  });

  it('rejects malformed PINs (non-4-digit)', async () => {
    const riley = seedMember('Riley');
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Riley', pin: '12', sessionSignup: false }, cookieFor(riley)),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid PIN format');
  });

  it('refuses to overwrite an existing pinHash (account hijack guard)', async () => {
    // Pre-seeded member with a PIN already set. A second create-account
    // attempt for that name MUST 409 — otherwise anyone who knows a
    // member's name could rewrite their PIN and lock them out.
    // Members only: a stranger can no longer name a target at all, so the
    // guard is held from the three directions that can still reach it.
    const casey = seedMember('Casey', { pinHash: 'old-hash' });
    const lin = seedMember('Lin');

    // 1. No cookie: refused before the name is looked at.
    const anon = await POST(
      makeRequest('POST', URL_PATH, { name: 'Casey', pin: '5821', sessionSignup: false }),
    );
    expect(anon.status).toBe(401);

    // 2. Another member's cookie naming Casey: the body's name is ignored, so
    //    the request can only ever act on Lin's own account.
    const viaOther = await POST(
      makeRequest('POST', URL_PATH, { name: 'Casey', pin: '5821', sessionSignup: false }, cookieFor(lin)),
    );
    expect(viaOther.status).toBe(201);
    expect((await viaOther.json()).name).toBe('Lin');

    // 3. Casey's own device, and an admin: the PIN is still not overwritten
    //    here — changing a PIN needs the current one (PATCH), not "create".
    const own = await POST(
      makeRequest('POST', URL_PATH, { name: 'Casey', pin: '5821', sessionSignup: false }, cookieFor(casey)),
    );
    expect(own.status).toBe(409);
    expect((await own.json()).error).toBe('account_exists');
    const byAdmin = await POST(
      makeAdminRequest('POST', URL_PATH, { name: 'Casey', pin: '5821', sessionSignup: false }),
    );
    expect(byAdmin.status).toBe(409);
    expect((await byAdmin.json()).error).toBe('account_exists');

    // Old pinHash unchanged, and still exactly one Casey.
    expect(membersNamed('Casey')).toHaveLength(1);
    expect(membersNamed('Casey')[0].pinHash).toBe('old-hash');
  });

  it('refuses a first-PIN set on a pre-seeded member from a device with no proof', async () => {
    // The name is on the invite list and holds no pinHash, so both guards above
    // pass — and that used to be the whole gate, which handed anyone who read
    // the name off GET /api/members a member_session bound to that person.
    // Same rule as the session-signup branch: claiming needs proof.
    // Members only: "no proof" is now refused at the door (401), before the
    // name is read — and a DIFFERENT member's proof cannot redirect the claim,
    // because the body's name is ignored for a non-admin.
    seedMember('Casey'); // no pinHash
    const lin = seedMember('Lin');

    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Casey', pin: '5821', sessionSignup: false }),
    );
    expect(res.status).toBe(401);
    // No cookie was minted for the caller.
    expect(res.cookies.get('member_session')).toBeUndefined();

    const viaOther = await POST(
      makeRequest('POST', URL_PATH, { name: 'Casey', pin: '5821', sessionSignup: false }, cookieFor(lin)),
    );
    // It acted on Lin's own account — never Casey's.
    expect(viaOther.status).toBe(201);
    expect((await viaOther.json()).name).toBe('Lin');

    // And nothing was written to Casey: the PIN is still unset.
    const caseys = membersNamed('Casey');
    expect(caseys).toHaveLength(1);
    expect(caseys[0].pinHash ?? '').toBe('');
  });

  it('claims a pre-seeded member from that member’s own device (cookie already minted)', async () => {
    const member = seedMember('Casey'); // no pinHash

    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Casey', pin: '5821', sessionSignup: false }, {
        Cookie: `member_session=${memberCookieValue('Casey', member.id)}`,
      }),
    );
    expect(res.status).toBe(201);

    const store = getStore();
    const members = (store['members'] ?? []) as Array<{ name: string; pinHash?: string }>;
    const caseys = members.filter((m) => m.name === 'Casey');
    expect(caseys).toHaveLength(1);
    expect(caseys[0].pinHash).toBeDefined();
    if (caseys[0].pinHash) {
      expect(await verifyPin('5821', caseys[0].pinHash)).toBe(true);
    }
  });

  it('an admin may still claim a pre-seeded member on their behalf', async () => {
    seedMember('Casey'); // no pinHash

    const res = await POST(
      makeAdminRequest('POST', URL_PATH, { name: 'Casey', pin: '5821', sessionSignup: false }),
    );
    expect(res.status).toBe(201);
    // An admin acting for someone else must not be handed that person's cookie.
    expect(res.cookies.get('member_session')).toBeUndefined();

    const store = getStore();
    const members = (store['members'] ?? []) as Array<{ name: string; pinHash?: string }>;
    expect(members.find((m) => m.name === 'Casey')?.pinHash).toBeDefined();
  });

  it('rate-limits at 3 attempts/hr per (name, IP)', async () => {
    // Rule 4 — the limiter runs BEFORE any auth check, so every attempt counts
    // toward the budget whatever the handler would have answered. These names
    // are seeded but unclaimed, so all three attempts are refused by the claim
    // gate (403); what the fourth proves is that the limiter, not the gate,
    // answers once the budget is spent.
    // Members only: each caller is a signed-in member acting on their own
    // account. The first attempt sets Spammer's PIN (201) and the next two are
    // refused by the overwrite guard (409); the fourth proves the limiter, not
    // a gate, answers once the budget is spent.
    const spammer = seedMember('Spammer');
    const different = seedMember('Different');
    const ip = { 'X-Client-IP': '10.99.0.1' };

    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await POST(
        makeRequest('POST', URL_PATH, { pin: '4827', sessionSignup: false }, { ...ip, ...cookieFor(spammer) }),
      );
      statuses.push(res.status);
    }
    expect(statuses).toEqual([201, 409, 409]);

    const fourth = await POST(
      makeRequest('POST', URL_PATH, { pin: '4827', sessionSignup: false }, { ...ip, ...cookieFor(spammer) }),
    );
    expect(fourth.status).toBe(429);

    // A different name from the same IP gets its own bucket — NOT refused by
    // the limiter.
    const otherName = await POST(
      makeRequest('POST', URL_PATH, { pin: '4827', sessionSignup: false }, { ...ip, ...cookieFor(different) }),
    );
    expect(otherName.status).toBe(201);
  });

  it('enforces invite list — a name nobody seeded cannot become an account', async () => {
    // Members only: a stranger is refused at the door (401) and a signed-in
    // member can only act on their own account, so no non-admin request can
    // mint a member for an unseeded name.
    const existing = seedMember('Existing'); // "NewPerson" is NOT on the list

    const anon = await POST(
      makeRequest('POST', URL_PATH, { name: 'NewPerson', pin: '4827', sessionSignup: false }),
    );
    expect(anon.status).toBe(401);

    await POST(
      makeRequest('POST', URL_PATH, { name: 'NewPerson', pin: '4827', sessionSignup: false }, cookieFor(existing)),
    );
    expect(membersNamed('NewPerson')).toEqual([]);
  });
});

describe('POST /api/players — default session signup', () => {
  it('still creates a session player when member has no PIN (PIN-less first-time signup)', async () => {
    const riley = seedMember('Riley'); // on invite list, no pinHash

    // Members only: the account's own cookie is the credential; no PIN needed.
    const res = await POST(
      makeRequest('POST', URL_PATH, {}, cookieFor(riley)),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.deleteToken).toMatch(/^[0-9a-f]{32}$/);

    const store = getStore();
    expect((store['players'] ?? []).filter((p) => (p as { name: string }).name === 'Riley')).toHaveLength(1);
  });

  it('refuses anonymous signup for a PIN-protected member (impersonation guard)', async () => {
    // Pre-seeded member already has a pinHash. The anonymous HomeTab signup
    // form (name only) MUST fail — otherwise anyone on the invite list
    // could sign up as anyone else on a fresh session before the rightful
    // owner gets there.
    // Members only: a name-only request is refused at the door (401) without
    // saying whether the name has a PIN, and another member's cookie cannot
    // put Riley on the list — the body's name is ignored for a non-admin.
    seedMember('Riley', { pinHash: 'someHash' });
    const lin = seedMember('Lin');

    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Riley' }),
    );
    expect(res.status).toBe(401);

    // No session player created
    const store = getStore();
    expect((store['players'] ?? [])).toHaveLength(0);

    const viaOther = await POST(makeRequest('POST', URL_PATH, { name: 'Riley' }, cookieFor(lin)));
    expect(viaOther.status).toBe(201);
    expect((await viaOther.json()).name).toBe('Lin');
    const rileyRows = ((getStore()['players'] ?? []) as Array<{ name: string }>).filter((p) => p.name === 'Riley');
    expect(rileyRows).toEqual([]);
  });
});
