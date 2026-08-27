import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { setMemberCookie, setAdminCookie, clearMemberCookie } from '../lib/auth';

/**
 * A `SameSite=Strict` cookie is NOT sent on a cross-site navigation, and an
 * OAuth callback is exactly that. Chrome evaluates the whole redirect chain, so
 * a Strict `member_session` set by a provider callback and then redirected to
 * `/bpm` is not sent on the landing request: the user holds a valid session and
 * the page renders signed-out.
 *
 * `Lax` still blocks cross-site POST and subresource sends, which is the CSRF
 * property that actually matters here -- every mutating route in this app is
 * POST/PATCH/DELETE with a JSON content type, which a simple cross-site form
 * cannot produce.
 */
describe('session cookie SameSite', () => {
  it('member_session is Lax so it survives an OAuth callback redirect', () => {
    const res = NextResponse.json({ ok: true });
    setMemberCookie(res, 'm1', 'Lin');
    const header = res.headers.getSetCookie().find((c) => c.startsWith('member_session='))!;
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Path=\/bpm/);
  });

  it('admin_session is Lax for the same reason', () => {
    const res = NextResponse.json({ ok: true });
    setAdminCookie(res, 'm1', 'Grant');
    const header = res.headers.getSetCookie().find((c) => c.startsWith('admin_session='))!;
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).toMatch(/HttpOnly/i);
  });

  it('the clear header matches the set header, or the browser will not delete it', () => {
    const res = NextResponse.json({ ok: true });
    clearMemberCookie(res);
    const headers = res.headers.getSetCookie().filter((c) => c.startsWith('member_session='));
    expect(headers.length).toBe(2); // current /bpm path + the legacy / path
    for (const h of headers) {
      expect(h).toMatch(/SameSite=Lax/i);
      expect(h).toMatch(/Max-Age=0/);
    }
  });
});
