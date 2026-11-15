import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  resetMockStore,
  seedGroup,
  seedMember,
  seedMembership,
  seedTestAdminMember,
  ADMIN_MEMBER_ID,
} from './helpers';
import { POST } from '@/app/api/auth/claim-name/route';
import { setPendingSignup, PENDING_COOKIE } from '../lib/pendingSignup';
import { lookupIdentity } from '../lib/authIdentity';
import { hashPin } from '../lib/recoveryHash';
import { rotateClaimLink } from '../lib/claimLinks';
import { readGroupClaim } from '../lib/auth';

/**
 * "IS THAT YOU?" LOOKS IN THE CLUB THE LINK IS FOR.
 *
 * `POST /api/auth/claim-name` links a new Google or Apple sign-in to an
 * existing member who proves their PIN or code. It looked the name up with
 * `resolveGroupId(req)`, which answers BPM for a signed-out browser, so Lin of
 * Riverside could never prove she was Lin, and a BPM Lin with the same name
 * was the one checked. The link the person arrived with is the only thing that
 * names their club. It was a one-time invite until docs/plans/one-way-in.md,
 * step 5; it is the club's link now, and an old invite's typed code fails.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const URL_ = 'http://localhost:3000/bpm/api/auth/claim-name';
let ipSeq = 0;

function pendingCookie(): string {
  const res = NextResponse.json({});
  setPendingSignup(res, {
    provider: 'google',
    sub: 'google-sub-lin',
    email: 'lin@example.com',
    emailVerified: true,
    suggestedName: null,
  });
  return res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${PENDING_COOKIE}=`))!
    .split(';')[0];
}

function req(body: Record<string, unknown>): NextRequest {
  return new NextRequest(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-IP': `10.17.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
      Cookie: pendingCookie(),
    },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function sessionClaim(res: Response): string | null {
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('member_session='));
  if (!cookie) return null;
  return readGroupClaim(decodeURIComponent(cookie.slice('member_session='.length).split(';')[0]));
}

let riversideLin: { id: string };

beforeEach(async () => {
  resetMockStore();
  process.env[FLAG] = 'true';
  await seedTestAdminMember();
  seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, name: 'BPM Badminton' });
  seedGroup('riverside', { ownerMemberId: ADMIN_MEMBER_ID, name: 'Riverside Badminton' });
  riversideLin = seedMember('Lin', { pinHash: await hashPin('2468') });
  seedMembership('riverside', riversideLin.id, { name: 'Lin' });
});

afterEach(() => {
  delete process.env[FLAG];
});

describe('claim-name with the club link', () => {
  it("finds the name on the invited club's roster and signs in to that club", async () => {
    const invite = await rotateClaimLink('riverside', ADMIN_MEMBER_ID);
    const res = await POST(req({ name: 'Lin', pin: '2468', inviteToken: invite!.token }));

    expect(res.status).toBe(200);
    expect((await lookupIdentity('google', 'google-sub-lin'))?.memberId).toBe(riversideLin.id);
    expect(sessionClaim(res)).toBe('riverside');
  });

  it('refuses a typed invite code: one-time invites were retired', async () => {
    const res = await POST(req({ name: 'Lin', pin: '2468', inviteCode: 'ABCD2345' }));
    expect(res.status).toBe(401);
    expect(await lookupIdentity('google', 'google-sub-lin')).toBeNull();
  });

  it('checks the invited club\'s Lin, not a BPM member with the same name', async () => {
    const bpmLin = seedMember('Lin', { pinHash: await hashPin('1357') });
    seedMembership('bpm', bpmLin.id, { name: 'Lin' });
    const invite = await rotateClaimLink('riverside', ADMIN_MEMBER_ID);

    // BPM Lin's PIN proves nothing about Riverside's Lin.
    const wrongClub = await POST(req({ name: 'Lin', pin: '1357', inviteToken: invite!.token }));
    expect(wrongClub.status).toBe(401);
    expect(await lookupIdentity('google', 'google-sub-lin')).toBeNull();

    const right = await POST(req({ name: 'Lin', pin: '2468', inviteToken: invite!.token }));
    expect(right.status).toBe(200);
    expect((await lookupIdentity('google', 'google-sub-lin'))?.memberId).toBe(riversideLin.id);
  });

  it('refuses an invite that no longer resolves, without falling back to BPM', async () => {
    const bpmLin = seedMember('Lin', { pinHash: await hashPin('1357') });
    seedMembership('bpm', bpmLin.id, { name: 'Lin' });

    const res = await POST(req({ name: 'Lin', pin: '1357', inviteToken: 'f'.repeat(32) }));
    expect(res.status).toBe(401);
    expect(await lookupIdentity('google', 'google-sub-lin')).toBeNull();
  });

  it('without an invite, still looks where it always did', async () => {
    // A signed-out browser resolves BPM, where there is no Lin.
    const res = await POST(req({ name: 'Lin', pin: '2468' }));
    expect(res.status).toBe(401);
  });
});

describe('claim-name with groups off', () => {
  it('ignores the invite: there is one club', async () => {
    delete process.env[FLAG];
    const bpmLin = seedMember('Lin2', { pinHash: await hashPin('1357') });
    const invite = await rotateClaimLink('riverside', ADMIN_MEMBER_ID);

    const res = await POST(req({ name: 'Lin2', pin: '1357', inviteToken: invite!.token }));
    expect(res.status).toBe(200);
    expect((await lookupIdentity('google', 'google-sub-lin'))?.memberId).toBe(bpmLin.id);
  });
});
