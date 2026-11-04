import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { completeSignIn } from '@/lib/authSession';
import { setMemberCookie } from '@/lib/auth';
import { POST } from '@/app/api/events/route';
import { resetMockStore, getStore, setupAdminPin } from './helpers';

/**
 * Roles v2, PR 4 (docs/plans/roles-v2.md): STAFF. The operator's own
 * `app_open`, `tab_view` and `sign_in` are not a member's usage and are not
 * written; everything else they do still is. The list in
 * `OPERATOR_MEMBER_IDS` is the staff list — there is no field to set.
 */
const before = process.env.OPERATOR_MEMBER_IDS;
const events = () => (getStore()['events'] ?? []) as Array<Record<string, unknown>>;

function cookie(memberId: string, name: string): string {
  const r = NextResponse.json({});
  setMemberCookie(r, memberId, name);
  return `member_session=${r.cookies.get('member_session')!.value}`;
}
let ip = 0;
const beacon = (memberId: string, name: string, body: unknown) =>
  POST(
    new NextRequest(new URL('/api/events', 'http://localhost/bpm'), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-client-ip': `staff-${++ip}`, cookie: cookie(memberId, name) },
    }),
  );

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env.OPERATOR_MEMBER_IDS = 'grant';
});
afterEach(() => {
  if (before === undefined) delete process.env.OPERATOR_MEMBER_IDS;
  else process.env.OPERATOR_MEMBER_IDS = before;
});

describe('the operator is staff', () => {
  it('app_open and tab_view from the operator are answered and not written', async () => {
    const open = await beacon('grant', 'Grant', { kind: 'app_open', platform: 'web' });
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ skipped: 'staff' });
    const tab = await beacon('grant', 'Grant', { kind: 'tab_view', tab: 'home' });
    expect(tab.status).toBe(200);
    expect(events()).toHaveLength(0);
  });

  it('a member\'s are written as ever', async () => {
    const res = await beacon('lin', 'Lin', { kind: 'app_open', platform: 'web' });
    expect(res.status).toBe(201);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ memberId: 'lin', kind: 'app_open' });
  });

  it('an ERROR from the operator\'s phone is still an error', async () => {
    const res = await beacon('grant', 'Grant', { kind: 'client_error', where: 'render', tab: 'home' });
    expect(res.status).toBe(201);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ memberId: 'grant', kind: 'client_error' });
  });

  it('the operator\'s sign-in is not recorded; a member\'s is', async () => {
    await completeSignIn(NextResponse.json({}), { id: 'grant', name: 'Grant', role: 'admin' }, 'bpm', 'pin');
    expect(events()).toHaveLength(0);
    await completeSignIn(NextResponse.json({}), { id: 'lin', name: 'Lin', role: 'member' }, 'bpm', 'pin');
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ memberId: 'lin', kind: 'sign_in', via: 'pin' });
  });

  it('with no list, nobody is staff', async () => {
    delete process.env.OPERATOR_MEMBER_IDS;
    const res = await beacon('grant', 'Grant', { kind: 'app_open', platform: 'web' });
    expect(res.status).toBe(201);
    expect(events()).toHaveLength(1);
  });
});
