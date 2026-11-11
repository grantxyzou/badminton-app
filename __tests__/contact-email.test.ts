import { describe, it, expect, beforeEach } from 'vitest';
import { GET as ME_GET, PATCH } from '../app/api/members/me/route';
import { GET as ROSTER_GET } from '../app/api/members/route';
import {
  resetMockStore,
  setupAdminPin,
  seedMember,
  seedAdminMember,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
  getStore,
} from './helpers';
import { parseContactEmail } from '../lib/contactEmail';

/**
 * The contact email (spec Q3, Grant 2026-11-11: "Q3 yes"): an address the
 * club can reach a member at. The member sets and clears their own; the
 * club's admins read it on the roster; nobody else sees it.
 */

const ME = 'http://localhost:3000/api/members/me';
const ROSTER = 'http://localhost:3000/api/members';

const asMember = (cookieName: string, body: Record<string, unknown>) =>
  makeRequest('PATCH', ME, body, { Cookie: `member_session=${memberCookieValue(cookieName)}` });
const stored = (name: string) =>
  getStore()['members'].find((m) => (m as { name: string }).name === name) as { contactEmail?: unknown };

describe('parseContactEmail', () => {
  it('trims and lowercases an address, clears on null or empty, refuses anything else', () => {
    expect(parseContactEmail('  Lin@Example.com ')).toBe('lin@example.com');
    expect(parseContactEmail(null)).toBeNull();
    expect(parseContactEmail('   ')).toBeNull();
    expect(parseContactEmail('not an email')).toBeUndefined();
    expect(parseContactEmail(42)).toBeUndefined();
    expect(parseContactEmail(`${'a'.repeat(250)}@x.co`)).toBeUndefined();
  });
});

describe('PATCH /api/members/me — contactEmail', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('refuses a write with no cookie — names are enumerable', async () => {
    seedMember('Lin');
    const res = await PATCH(makeRequest('PATCH', ME, { name: 'Lin', contactEmail: 'lin@example.com' }));
    expect(res.status).toBe(401);
    expect(stored('Lin').contactEmail).toBeUndefined();
  });

  it("refuses another member's cookie, and an admin's: only the member sets their own", async () => {
    seedMember('Lin');
    seedMember('Viktor');
    seedAdminMember();
    const other = await PATCH(asMember('Viktor', { name: 'Lin', contactEmail: 'x@example.com' }));
    expect(other.status).toBe(401);
    const admin = await PATCH(makeAdminRequest('PATCH', ME, { name: 'Lin', contactEmail: 'x@example.com' }));
    expect(admin.status).toBe(401);
    expect(stored('Lin').contactEmail).toBeUndefined();
  });

  it('saves the member\'s own address, and an empty value clears it', async () => {
    seedMember('Lin');
    const set = await PATCH(asMember('Lin', { name: 'Lin', contactEmail: ' Lin@Example.com' }));
    expect(set.status).toBe(200);
    expect((await set.json()).contactEmail).toBe('lin@example.com');
    expect(stored('Lin').contactEmail).toBe('lin@example.com');

    const cleared = await PATCH(asMember('Lin', { name: 'Lin', contactEmail: '' }));
    expect(cleared.status).toBe(200);
    expect(stored('Lin').contactEmail).toBeUndefined();
  });

  it('refuses something that is not an address, and keeps what was there', async () => {
    seedMember('Lin', { contactEmail: 'lin@example.com' });
    const res = await PATCH(asMember('Lin', { name: 'Lin', contactEmail: 'lin at example' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_email');
    expect(stored('Lin').contactEmail).toBe('lin@example.com');
  });

  it('leaves the rest of the member alone', async () => {
    seedMember('Lin', { avatar: { kind: 'birdie', colour: 'green' } });
    await PATCH(asMember('Lin', { name: 'Lin', contactEmail: 'lin@example.com' }));
    expect((stored('Lin') as { avatar?: unknown }).avatar).toEqual({ kind: 'birdie', colour: 'green' });
  });
});

describe('who reads it back', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('members/me returns it to its owner', async () => {
    seedMember('Lin', { contactEmail: 'lin@example.com' });
    const asLin = makeRequest('GET', `${ME}?name=Lin`, undefined, {
      Cookie: `member_session=${memberCookieValue('Lin')}`,
    });
    expect((await (await ME_GET(asLin)).json()).contactEmail).toBe('lin@example.com');
  });

  it('members/me does not return it to an admin asking about someone else', async () => {
    seedMember('Lin', { contactEmail: 'lin@example.com' });
    seedAdminMember();
    const res = await ME_GET(makeAdminRequest('GET', `${ME}?name=Lin`));
    expect(res.status).toBe(200);
    expect((await res.json()).contactEmail).toBeNull();
  });

  it("a fellow member's roster never carries it", async () => {
    seedMember('Lin', { contactEmail: 'lin@example.com' });
    seedMember('Viktor');
    const asViktor = makeRequest('GET', ROSTER, undefined, {
      Cookie: `member_session=${memberCookieValue('Viktor')}`,
    });
    const body = await (await ROSTER_GET(asViktor)).text();
    expect(body).not.toContain('lin@example.com');
    expect(body).not.toContain('contactEmail');
  });

  it("the club's admins read it on the roster", async () => {
    seedMember('Lin', { contactEmail: 'lin@example.com' });
    seedAdminMember();
    const rows = (await (await ROSTER_GET(makeAdminRequest('GET', ROSTER))).json()) as Array<{ name: string; contactEmail?: string }>;
    expect(rows.find((r) => r.name === 'Lin')?.contactEmail).toBe('lin@example.com');
  });
});
