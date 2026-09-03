import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetMockStore, getStore, setupAdminPin, makeRequest, memberCookieValue } from './helpers';
import { getActiveSessionId } from '../lib/cosmos';

/**
 * The two migration routes. The property that is easy to get wrong and
 * invisible in the UI: a claimed member must be able to CANCEL THEIR OWN
 * SPOT afterwards. `DELETE /api/players` accepts admin or deleteToken, never
 * member_session, so "signed in" is not the same as "can cancel" — the claim
 * has to re-mint the token, and this file asserts the token it returns is the
 * one on the Player doc.
 */
const START = 'http://localhost:3000/api/auth/migrate/start';
const CLAIM = 'http://localhost:3000/api/auth/migrate/claim';
let ipSeq = 0;
const ip = () => `10.7.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`;

function seedMember(name: string, id = `member-${name.toLowerCase()}`, extra: Record<string, unknown> = {}) {
  const store = getStore();
  if (!store['members']) store['members'] = [];
  store['members'].push({ id, name, role: 'member', active: true, sessionCount: 0, createdAt: new Date().toISOString(), pinHash: 'secret-hash', ...extra });
  return id;
}

async function seedPlayer(name: string) {
  const store = getStore();
  const sessionId = await getActiveSessionId();
  if (!store['players']) store['players'] = [];
  const doc = { id: `player-${name.toLowerCase()}`, sessionId, name, deleteToken: 'old-token', createdAt: new Date().toISOString() };
  store['players'].push(doc);
  return doc;
}

function players() {
  return (getStore()['players'] ?? []) as Array<{ name: string; deleteToken?: string }>;
}

async function start(name: string, memberId: string, extraHeaders: Record<string, string> = {}) {
  const { POST } = await import('../app/api/auth/migrate/start/route');
  return POST(makeRequest('POST', START, {}, { Cookie: `member_session=${memberCookieValue(name, memberId)}`, 'X-Client-IP': ip(), ...extraHeaders }));
}

async function claim(body: Record<string, unknown>) {
  const { POST } = await import('../app/api/auth/migrate/claim/route');
  return POST(makeRequest('POST', CLAIM, body, { 'X-Client-IP': ip() }));
}

const setCookies = (res: Response) => res.headers.getSetCookie().join('\n');

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_NATIVE_MIGRATE = 'true';
  process.env.APP_ORIGIN = 'https://bpm.grantzou.com';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_NATIVE_MIGRATE;
  delete process.env.APP_ORIGIN;
});

describe('POST /api/auth/migrate/start', () => {
  it('404s with the flag off', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_NATIVE_MIGRATE;
    const id = seedMember('Lin');
    expect((await start('Lin', id)).status).toBe(404);
  });

  it('requires a member session', async () => {
    const { POST } = await import('../app/api/auth/migrate/start/route');
    const res = await POST(makeRequest('POST', START, {}, { 'X-Client-IP': ip() }));
    expect(res.status).toBe(401);
  });

  it('refuses an inactive member', async () => {
    const id = seedMember('Lin', 'member-lin', { active: false });
    expect((await start('Lin', id)).status).toBe(403);
  });

  it('returns a link on the outbound origin, a short code, and stores only hashes', async () => {
    const id = seedMember('Lin');
    const res = await start('Lin', id, { Cookie: `member_session=${memberCookieValue('Lin', id)}; NEXT_LOCALE=zh-CN` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.link).toBe(`https://bpm.grantzou.com/bpm/migrate?c=${body.linkCode}`);
    expect(body.shortCode).toMatch(/^\d{6}$/);
    const raw = JSON.stringify(getStore()['authmigration']);
    expect(raw).not.toContain(body.linkCode);
    expect(raw).not.toContain(body.shortCode);
    expect(raw).toContain('"locale":"zh-CN"');
  });

  it('503s rather than building the link from the request when APP_ORIGIN is unset in prod', async () => {
    const id = seedMember('Lin');
    delete process.env.APP_ORIGIN;
    const saved = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    try {
      expect((await start('Lin', id)).status).toBe(503);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = saved ?? 'test';
    }
  });
});

describe('POST /api/auth/migrate/claim', () => {
  it('404s with the flag off', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_NATIVE_MIGRATE;
    expect((await claim({ link: 'a'.repeat(64) })).status).toBe(404);
  });

  it('400s a body with neither shape, or both', async () => {
    expect((await claim({})).status).toBe(400);
    expect((await claim({ link: 'x', name: 'Lin', short: '123456' })).status).toBe(400);
  });

  it('unknown, expired and used codes are one 404', async () => {
    const res = await claim({ link: 'a'.repeat(64) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ status: 'none' });
    expect(setCookies(res)).not.toContain('member_session');
  });

  it('claims by link: signs in, re-mints deleteToken on the ACTIVE-session player, sets locale', async () => {
    const id = seedMember('Lin');
    await seedPlayer('Lin');
    const minted = await (await start('Lin', id, { Cookie: `member_session=${memberCookieValue('Lin', id)}; NEXT_LOCALE=zh-CN` })).json();

    const res = await claim({ link: minted.linkCode });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ready', name: 'Lin', memberId: id });
    expect(body.sessionId).toBe(await getActiveSessionId());
    // The token the client will store is the token on the doc — that is what
    // lets DELETE /api/players accept the cancel.
    expect(body.deleteToken).toMatch(/^[0-9a-f]{32}$/);
    expect(body.deleteToken).not.toBe('old-token');
    expect(players().find((p) => p.name === 'Lin')!.deleteToken).toBe(body.deleteToken);
    // No secret leaks.
    expect(JSON.stringify(body)).not.toContain('secret-hash');
    // Cookies: session minted, locale carried, order safe.
    const cookies = setCookies(res);
    expect(cookies).toContain('member_session=');
    expect(cookies).toContain('NEXT_LOCALE=zh-CN');
  });

  it('claims by short code with a null deleteToken when the member is not registered', async () => {
    const id = seedMember('Lin');
    const minted = await (await start('Lin', id)).json();
    const res = await claim({ name: 'lin', short: minted.shortCode });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ready', name: 'Lin', deleteToken: null });
    expect(setCookies(res)).toContain('member_session=');
  });

  it('a second claim of either half fails after the first succeeds', async () => {
    const id = seedMember('Lin');
    const minted = await (await start('Lin', id)).json();
    expect((await claim({ link: minted.linkCode })).status).toBe(200);
    expect((await claim({ link: minted.linkCode })).status).toBe(404);
    expect((await claim({ name: 'Lin', short: minted.shortCode })).status).toBe(404);
  });

  it('refuses a member deactivated between mint and claim', async () => {
    const id = seedMember('Lin');
    const minted = await (await start('Lin', id)).json();
    const store = getStore();
    store['members'] = (store['members'] as Array<{ id: string }>).map((m) => (m.id === id ? { ...m, active: false } : m));
    expect((await claim({ link: minted.linkCode })).status).toBe(403);
  });

  it('a claimed admin gets the admin cookie; a member does not', async () => {
    const adminId = seedMember('Grant', 'member-grant', { role: 'admin' });
    const a = await (await start('Grant', adminId)).json();
    expect(setCookies(await claim({ link: a.linkCode }))).toContain('admin_session=');

    const id = seedMember('Lin');
    const m = await (await start('Lin', id)).json();
    const cookies = setCookies(await claim({ link: m.linkCode }));
    expect(cookies).not.toMatch(/admin_session=[^;]+;/);
  });
});
