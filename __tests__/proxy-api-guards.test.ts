import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { apiGuards, proxy } from '../proxy';

/**
 * The two request-level guards on mutating `/api/*` calls: a declared body
 * over the cap is 413 before any read, and a cross-site write is 403 unless
 * it is Apple's form_post callback. Defence in depth — no handler relies on
 * either, so this is where they are proven.
 */
function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`https://bpm.example.com${path}`, {
    method: init.method ?? 'POST',
    headers: { host: 'bpm.example.com', ...(init.headers ?? {}) },
  });
}

describe('apiGuards', () => {
  it('lets a same-origin write through', () => {
    expect(apiGuards(req('/api/players', { headers: { origin: 'https://bpm.example.com', 'sec-fetch-site': 'same-origin', 'content-length': '120' } }))).toBeNull();
  });

  it('lets a client that sends neither header through (second line, not first)', () => {
    expect(apiGuards(req('/api/players'))).toBeNull();
  });

  it('never touches a read', () => {
    expect(apiGuards(req('/api/players', { method: 'GET', headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' } }))).toBeNull();
  });

  it('refuses a declared body over the cap with 413, before any read', () => {
    const res = apiGuards(req('/api/report', { headers: { 'content-length': String(256 * 1024 + 1) } }));
    expect(res?.status).toBe(413);
  });

  it('refuses Sec-Fetch-Site: cross-site with 403', () => {
    expect(apiGuards(req('/api/players', { headers: { 'sec-fetch-site': 'cross-site' } }))?.status).toBe(403);
  });

  it('refuses an Origin whose host is not the request host, and a null Origin', () => {
    expect(apiGuards(req('/api/players', { headers: { origin: 'https://evil.example' } }))?.status).toBe(403);
    expect(apiGuards(req('/api/players', { headers: { origin: 'null' } }))?.status).toBe(403);
  });

  it("exempts Apple's form_post callback, which is cross-site by design", () => {
    const r = req('/api/auth/apple/callback', { headers: { origin: 'https://appleid.apple.com', 'sec-fetch-site': 'cross-site', 'content-length': '900' } });
    expect(apiGuards(r)).toBeNull();
  });

  it('applies through proxy() and sets no locale cookie on an API response', () => {
    const blocked = proxy(req('/api/players', { headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(blocked.status).toBe(403);
    const allowed = proxy(req('/api/players'));
    expect(allowed.status).toBe(200);
    expect(allowed.cookies.get('NEXT_LOCALE')).toBeUndefined();
  });

  it('still sets the locale cookie on a page request', () => {
    const page = proxy(new NextRequest('https://bpm.example.com/', { headers: { 'accept-language': 'zh-CN' } }));
    expect(page.cookies.get('NEXT_LOCALE')?.value).toBe('zh-CN');
  });
});
