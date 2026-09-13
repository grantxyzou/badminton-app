import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedMember,
  seedTestAdminMember,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
  getStore,
  ADMIN_MEMBER_ID,
} from './helpers';
import { hasSignInMethod, readSignInReadiness } from '@/lib/signInReadiness';
import { GET } from '@/app/api/admin/sign-in-readiness/route';

/**
 * MEMBERS ONLY, PART 4 (docs/plans/members-only.md): who would be locked out
 * if the flag flipped today. The flip waits on this list, so a wrong zero is
 * the dangerous answer.
 */

const URL_PATH = 'http://localhost:3000/bpm/api/admin/sign-in-readiness';

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
});

describe('hasSignInMethod', () => {
  it('a PIN, a password or a linked provider each count', () => {
    expect(hasSignInMethod({ pinHash: 'x' })).toBe(true);
    expect(hasSignInMethod({ passwordHash: 'x' })).toBe(true);
    expect(hasSignInMethod({ linkedProviders: ['google'] })).toBe(true);
  });

  it('nothing, or an EMPTY value, does not', () => {
    // A recovery-code redemption clears a PIN to '' rather than deleting it,
    // so an empty string is the shape a locked-out member actually has.
    expect(hasSignInMethod({})).toBe(false);
    expect(hasSignInMethod({ pinHash: '' })).toBe(false);
    expect(hasSignInMethod({ passwordHash: '' })).toBe(false);
    expect(hasSignInMethod({ linkedProviders: [] })).toBe(false);
  });
});

describe('readSignInReadiness', () => {
  it('counts the active roster and names only those with no way in', async () => {
    seedMember('Lin', { pinHash: 'x' });
    seedMember('Viktor', { passwordHash: 'x' });
    seedMember('Carolina', { linkedProviders: ['google'] });
    seedMember('Kento');
    seedMember('Akane', { pinHash: '' });
    seedMember('Gone', { active: false }); // not on the roster, not counted

    const r = await readSignInReadiness('bpm');
    expect(r.total).toBe(5);
    expect(r.ready).toBe(3);
    expect(r.cannotSignIn).toEqual(['Akane', 'Kento']);
  });
});

describe('GET /api/admin/sign-in-readiness', () => {
  it('an admin gets the list — names only, no credential material', async () => {
    await seedTestAdminMember();
    seedMember('Kento');
    const res = await GET(makeAdminRequest('GET', URL_PATH));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cannotSignIn).toEqual(['Kento']);
    expect(JSON.stringify(body)).not.toMatch(/pinHash|passwordHash|recoveryCode/);
  });

  it('a signed-in member who is not an admin is refused', async () => {
    seedMember('Lin', { id: 'member-lin', pinHash: 'x' });
    const res = await GET(
      makeRequest('GET', URL_PATH, undefined, { Cookie: `member_session=${memberCookieValue('Lin', 'member-lin')}` }),
    );
    expect(res.status).toBe(401);
  });

  it('a DEMOTED admin with a live cookie is refused — this is the unclaimed-account list', async () => {
    await seedTestAdminMember();
    const admin = (getStore()['members'] as Array<{ id: string; role: string }>).find((m) => m.id === ADMIN_MEMBER_ID)!;
    admin.role = 'member';
    const res = await GET(makeAdminRequest('GET', URL_PATH));
    expect(res.status).toBe(401);
  });

  it('no cookie at all is refused', async () => {
    const res = await GET(makeRequest('GET', URL_PATH));
    expect(res.status).toBe(401);
  });
});
