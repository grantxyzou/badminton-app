import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';

function makeReq(opts: { cookie?: string; acceptLanguage?: string }) {
  const url = 'http://localhost:3000/';
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (opts.acceptLanguage) headers.set('accept-language', opts.acceptLanguage);
  return new NextRequest(url, { headers });
}

describe('middleware', () => {
  it('sets NEXT_LOCALE cookie from Accept-Language on first visit', () => {
    const res = middleware(makeReq({ acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8' }));
    const cookie = res.cookies.get('NEXT_LOCALE');
    expect(cookie?.value).toBe('zh-CN');
    expect(cookie?.path).toBe('/bpm');
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.maxAge).toBe(60 * 60 * 24 * 365);
  });

  it('defaults to en when Accept-Language has no supported match', () => {
    const res = middleware(makeReq({ acceptLanguage: 'fr-FR' }));
    expect(res.cookies.get('NEXT_LOCALE')?.value).toBe('en');
  });

  it('defaults to en when no Accept-Language header is present', () => {
    const res = middleware(makeReq({}));
    expect(res.cookies.get('NEXT_LOCALE')?.value).toBe('en');
  });

  it('is a no-op when NEXT_LOCALE cookie is already present', () => {
    const res = middleware(
      makeReq({ cookie: 'NEXT_LOCALE=zh-CN', acceptLanguage: 'en-US' }),
    );
    expect(res.cookies.get('NEXT_LOCALE')).toBeUndefined();
  });
});
