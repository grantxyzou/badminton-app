import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetMockStore, seedMember, getStore } from './helpers';
import { reserveIdentity } from '../lib/authIdentity';
import { MAX_EMAIL_CODE_ATTEMPTS } from '../lib/emailCode';

/**
 * Logging in with a code emailed to you (docs/plans/one-way-in.md, step 3).
 *
 * The two routes keep the promises `forgot-password` and `signin` keep:
 * `start` gives one answer whether or not the address has an account, and
 * `verify` gives one 401 for every way of failing. The code is single use,
 * ten minutes, five wrong tries, and a new one replaces the old.
 */
const sent: Array<{ to: string; name: string; code: string }> = [];
vi.mock('@/lib/authEmail', () => ({
  sendSignInCodeEmail: vi.fn(async (to: string, name: string, code: string) => {
    sent.push({ to, name, code });
    return { sent: true };
  }),
}));

import { POST as start } from '@/app/api/auth/email-code/start/route';
import { POST as verify } from '@/app/api/auth/email-code/verify/route';

// The rate limiter keeps its counts for the life of the file, and the
// per-address limit is the point of one test: every test gets its own address.
let seq = 0;
let addr = '';
let stranger = '';

let ipSeq = 0;
function req(path: string, body: unknown, ip = `10.21.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`): NextRequest {
  return new NextRequest(`http://localhost:3000/bpm/api/auth/email-code/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-IP': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

const stored = (id: string) =>
  (getStore()['members'] as Array<Record<string, unknown>>).find((m) => m.id === id)! as {
    emailCode?: { hash: string; expiresAt: number; attempts?: number };
    emailVerified?: boolean;
  };

async function seedAkane(over: Record<string, unknown> = {}) {
  const akane = seedMember('Akane', { email: addr, emailVerified: false, ...over });
  await reserveIdentity('email', addr, akane.id);
  return akane;
}

beforeEach(() => {
  resetMockStore();
  sent.length = 0;
  seq += 1;
  addr = `akane${seq}@example.com`;
  stranger = `nobody${seq}@example.com`;
});

describe('POST /api/auth/email-code/start', () => {
  it('mails a 6-digit code to an account and stores only its hash', async () => {
    const akane = await seedAkane();
    const res = await start(req('start', { email: ` ${addr.replace('akane', 'Akane')} ` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ to: addr, name: 'Akane' });
    expect(sent[0].code).toMatch(/^[0-9]{6}$/);
    const code = stored(akane.id).emailCode!;
    expect(code.hash).not.toContain(sent[0].code);
    expect(code.expiresAt).toBeGreaterThan(Date.now());
  });

  it('answers an unknown address exactly the same, and sends nothing', async () => {
    const res = await start(req('start', { email: stranger }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toHaveLength(0);
  });

  it('sends nothing to a removed member, with the same answer', async () => {
    await seedAkane({ active: false });
    const res = await start(req('start', { email: addr }));
    expect(await res.json()).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toHaveLength(0);
  });

  it('answers a malformed body with the same 200', async () => {
    expect((await start(req('start', 'not json'))).status).toBe(200);
    expect((await start(req('start', { email: 'not-an-address' }))).status).toBe(200);
  });

  it('limits codes per address, whoever asks and whether or not it has an account', async () => {
    await seedAkane();
    for (const email of [addr, stranger]) {
      const answers = [];
      for (let i = 0; i < 4; i++) answers.push((await start(req('start', { email }))).status);
      expect(answers).toEqual([200, 200, 200, 429]);
    }
  });
});

describe('POST /api/auth/email-code/verify', () => {
  async function codeFor(email = addr) {
    await start(req('start', { email }));
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    return sent[sent.length - 1].code;
  }

  it('logs in with the right code, uses it up, and marks the address verified', async () => {
    const akane = await seedAkane();
    const code = await codeFor();

    const res = await verify(req('verify', { email: addr, code }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: akane.id, name: 'Akane', emailVerified: true });
    expect(res.headers.getSetCookie().join('\n')).toMatch(/member_session=[^;]+;/);
    expect(stored(akane.id).emailCode).toBeUndefined();
    expect(stored(akane.id).emailVerified).toBe(true);

    // Single use.
    const again = await verify(req('verify', { email: addr, code }));
    expect(again.status).toBe(401);
  });

  it('accepts the code with spaces in it, as people copy it', async () => {
    await seedAkane();
    const code = await codeFor();
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect((await verify(req('verify', { email: addr, code: spaced }))).status).toBe(200);
  });

  it('gives a wrong code, an unknown address and no code at all the same answer', async () => {
    await seedAkane();
    const code = await codeFor();
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');

    const answers = await Promise.all([
      verify(req('verify', { email: addr, code: wrong })),
      verify(req('verify', { email: stranger, code })),
      verify(req('verify', { email: addr, code: 'abc' })),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_code' });
      expect(res.headers.getSetCookie().join('\n')).not.toMatch(/member_session=[^;]+;/);
    }
  });

  it(`stops working after ${MAX_EMAIL_CODE_ATTEMPTS} wrong tries, even for the right code`, async () => {
    const akane = await seedAkane();
    const code = await codeFor();
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    for (let i = 0; i < MAX_EMAIL_CODE_ATTEMPTS; i++) {
      expect((await verify(req('verify', { email: addr, code: wrong }))).status).toBe(401);
    }
    expect(stored(akane.id).emailCode?.attempts).toBe(MAX_EMAIL_CODE_ATTEMPTS);
    expect((await verify(req('verify', { email: addr, code }))).status).toBe(401);
  });

  it('refuses an expired code', async () => {
    const akane = await seedAkane();
    const code = await codeFor();
    stored(akane.id).emailCode!.expiresAt = Date.now() - 1;
    expect((await verify(req('verify', { email: addr, code }))).status).toBe(401);
  });

  it('a new code replaces the old one', async () => {
    await seedAkane();
    const first = await codeFor();
    const second = await codeFor();
    if (first !== second) {
      expect((await verify(req('verify', { email: addr, code: first }))).status).toBe(401);
    }
    expect((await verify(req('verify', { email: addr, code: second }))).status).toBe(200);
  });

  it('refuses a member removed after the code was sent', async () => {
    const akane = await seedAkane();
    const code = await codeFor();
    (stored(akane.id) as { active?: boolean }).active = false;
    expect((await verify(req('verify', { email: addr, code }))).status).toBe(401);
  });

  it('never returns the stored code', async () => {
    await seedAkane();
    const code = await codeFor();
    const res = await verify(req('verify', { email: addr, code }));
    expect(JSON.stringify(await res.json())).not.toContain('emailCode');
  });
});
