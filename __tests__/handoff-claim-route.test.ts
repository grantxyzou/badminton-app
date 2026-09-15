import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { resetMockStore, setupAdminPin, seedMember } from './helpers';
import { createHandoffId, handoffRef, beginHandoff, completeHandoff } from '../lib/authHandoff';
import { PENDING_COOKIE, readPendingSignup } from '../lib/pendingSignup';

/**
 * POST /api/auth/handoff/claim — the app collecting a sign-in that finished in
 * another window. The store's rules are pinned in auth-handoff.test.ts; this
 * pins what the ROUTE does with each answer, which is where a session cookie or
 * a pending-signup cookie actually gets minted.
 */

let ipSeq = 0;
async function claim(body: unknown) {
  const { POST } = await import('../app/api/auth/handoff/claim/route');
  return POST(
    new NextRequest('https://bpm.grantzou.com/bpm/api/auth/handoff/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-IP': `10.44.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}` },
      body: JSON.stringify(body),
    }),
  );
}

const sessionCookie = (res: Response) => res.headers.getSetCookie().find((c) => /^member_session=[^;]+;/.test(c));

async function webStash(outcome: Parameters<typeof completeHandoff>[1]) {
  const id = createHandoffId();
  const ref = handoffRef(id);
  await beginHandoff(ref, { state: 's'.repeat(64), codeVerifier: 'v' });
  const done = await completeHandoff(ref, outcome);
  return { id, typedCode: done!.typedCode! };
}

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
});

describe('POST /api/auth/handoff/claim', () => {
  it('asks for the code, and mints no session, when only the preimage is sent', async () => {
    const m = seedMember('Lin');
    const { id } = await webStash(m.id);
    const res = await claim({ handoffId: id });
    expect(await res.json()).toEqual({ status: 'code_required', wrong: false });
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('signs the app in with the typed code', async () => {
    const m = seedMember('Lin');
    const { id, typedCode } = await webStash(m.id);
    const res = await claim({ handoffId: id, typedCode });
    expect(await res.json()).toMatchObject({ status: 'ready', name: 'Lin' });
    expect(sessionCookie(res)).toBeTruthy();
  });

  it('says a wrong code was wrong, without a session', async () => {
    const m = seedMember('Lin');
    const { id, typedCode } = await webStash(m.id);
    const res = await claim({ handoffId: id, typedCode: typedCode === '000000' ? '111111' : '000000' });
    expect(await res.json()).toEqual({ status: 'code_required', wrong: true });
    expect(sessionCookie(res)).toBeUndefined();
  });

  /**
   * GUARANTEE 4. A new identity's pending-signup cookie is minted HERE, in the
   * app's jar — an ordinary one, so the app's name step signs the app in.
   */
  it('a new identity sets an ordinary pending-signup cookie in the app, and no session', async () => {
    const facts = { provider: 'google' as const, sub: 'g-new', email: 'new@example.com', emailVerified: true, suggestedName: null };
    const { id, typedCode } = await webStash({ pending: facts });
    const res = await claim({ handoffId: id, typedCode });

    expect(await res.json()).toEqual({ status: 'needs_name' });
    expect(sessionCookie(res)).toBeUndefined();
    const header = res.headers.getSetCookie().find((c) => c.startsWith(`${PENDING_COOKIE}=`))!;
    const parsed = readPendingSignup(
      new NextRequest('https://bpm.grantzou.com/bpm/api/auth/complete-signup', { headers: { Cookie: header.split(';')[0] } }),
    );
    expect(parsed).toMatchObject({ provider: 'google', sub: 'g-new', email: 'new@example.com', emailVerified: true });
    expect(parsed?.parked).toBeUndefined();
    expect(parsed?.handoff ?? null).toBeNull();
  });

  /* One gym, one wifi, one IP: the typed-code limit must not be shared by a
     whole club. */
  it('does not share the typed-code limit between people on the same network', async () => {
    const { POST } = await import('../app/api/auth/handoff/claim/route');
    const sameIp = (body: unknown) =>
      POST(
        new NextRequest('https://bpm.grantzou.com/bpm/api/auth/handoff/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-IP': '10.45.0.1' },
          body: JSON.stringify(body),
        }),
      );
    for (let person = 0; person < 12; person++) {
      const m = seedMember(`Player ${person}`);
      const { id, typedCode } = await webStash(m.id);
      const res = await sameIp({ handoffId: id, typedCode });
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('ready');
    }
  });

  it('refuses a malformed typed code rather than dropping it', async () => {
    const { id } = await webStash('member-x');
    expect((await claim({ handoffId: id, typedCode: '12345' })).status).toBe(400);
    expect((await claim({ handoffId: id, typedCode: 123456 })).status).toBe(400);
  });
});
