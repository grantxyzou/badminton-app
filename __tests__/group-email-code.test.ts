import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  resetMockStore,
  seedGroup,
  seedMember,
  seedMembership,
  seedTestAdminMember,
  ADMIN_MEMBER_ID,
} from './helpers';
import { reserveIdentity } from '../lib/authIdentity';
import { readGroupClaim } from '../lib/auth';

/**
 * Email-code sign-in with two clubs (docs/plans/one-way-in.md, step 3).
 *
 * A signed-out browser carries no club, so the code signs in the way the
 * password does: `completeSignIn` is asked for BPM and mints only what the
 * person holds there. An organiser of ANOTHER club must not come away with a
 * BPM admin cookie, and the page gate then offers them their own clubs.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const sent: string[] = [];
vi.mock('@/lib/authEmail', () => ({
  sendSignInCodeEmail: vi.fn(async (_to: string, _name: string, code: string) => {
    sent.push(code);
    return { sent: true };
  }),
}));

import { POST as start } from '@/app/api/auth/email-code/start/route';
import { POST as verify } from '@/app/api/auth/email-code/verify/route';

let ipSeq = 0;
function req(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/bpm/api/auth/email-code/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-IP': `10.22.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}` },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function cookie(res: Response, name: string): string | null {
  const c = res.headers.getSetCookie().find((s) => s.startsWith(`${name}=`) && !s.startsWith(`${name}=;`));
  return c ? decodeURIComponent(c.slice(name.length + 1).split(';')[0]) : null;
}

beforeEach(async () => {
  resetMockStore();
  sent.length = 0;
  process.env[FLAG] = 'true';
  await seedTestAdminMember();
  seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, name: 'BPM Core' });
  seedGroup('riverside', { ownerMemberId: 'chong', name: 'Riverside' });
});

afterEach(() => {
  delete process.env[FLAG];
});

describe('email-code sign-in across clubs', () => {
  it("another club's organiser gets no BPM admin cookie", async () => {
    const chong = seedMember('Chong Wei', { email: 'chong@example.com' });
    await reserveIdentity('email', 'chong@example.com', chong.id);
    seedMembership('riverside', chong.id, { name: 'Chong Wei', role: 'owner' });

    await start(req('start', { email: 'chong@example.com' }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const res = await verify(req('verify', { email: 'chong@example.com', code: sent[0] }));

    expect(res.status).toBe(200);
    expect(cookie(res, 'member_session')).not.toBeNull();
    expect(cookie(res, 'admin_session')).toBeNull();
    // Asked for BPM, as the password sign-in is: the page gate then lists
    // their own clubs rather than this route guessing one.
    expect(readGroupClaim(cookie(res, 'member_session'))).toBe('bpm');
  });

  it("BPM's own admin signs in with the admin cookie too", async () => {
    const admin = seedMember('Kento', { email: 'kento@example.com', role: 'admin' });
    await reserveIdentity('email', 'kento@example.com', admin.id);
    seedMembership('bpm', admin.id, { name: 'Kento', role: 'admin' });

    await start(req('start', { email: 'kento@example.com' }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const res = await verify(req('verify', { email: 'kento@example.com', code: sent[0] }));

    expect(res.status).toBe(200);
    expect(readGroupClaim(cookie(res, 'admin_session'))).toBe('bpm');
  });
});
