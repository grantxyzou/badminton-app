import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { completeSignIn } from '../lib/authSession';

function cookieHeaders(res: NextResponse): string {
  return res.headers.getSetCookie().join('\n');
}

describe('completeSignIn', () => {
  it('issues a member session for any member', async () => {
    const res = NextResponse.json({ ok: true });
    await completeSignIn(res, { id: 'm1', name: 'Lin', role: 'member' }, 'bpm');
    expect(cookieHeaders(res)).toMatch(/member_session=[^;]+;/);
  });

  it('issues an admin session for an admin', async () => {
    const res = NextResponse.json({ ok: true });
    await completeSignIn(res, { id: 'm1', name: 'Grant', role: 'admin' }, 'bpm');
    const headers = cookieHeaders(res);
    expect(headers).toMatch(/member_session=[^;]+;/);
    expect(headers).toMatch(/admin_session=[^;]+;/);
  });

  it('CLEARS a stale admin cookie when a non-admin signs in', async () => {
    // The regression this exists to prevent: admin powers persisting across
    // sign-out -> sign-in-as-a-different-player on a shared device.
    const res = NextResponse.json({ ok: true });
    await completeSignIn(res, { id: 'm2', name: 'Lin', role: 'member' }, 'bpm');
    expect(cookieHeaders(res)).toMatch(/admin_session=;[^\n]*Max-Age=0/);
  });

  it('treats a member with no role at all as a non-admin', async () => {
    const res = NextResponse.json({ ok: true });
    await completeSignIn(res, { id: 'm3', name: 'Viktor' }, 'bpm');
    const headers = cookieHeaders(res);
    expect(headers).toMatch(/member_session=[^;]+;/);
    expect(headers).toMatch(/admin_session=;[^\n]*Max-Age=0/);
  });
});
