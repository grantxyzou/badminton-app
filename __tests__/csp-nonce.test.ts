import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { proxy, config } from '../proxy';
import { buildCsp } from '../lib/csp';

/**
 * Scripts run only with this request's nonce (audit, 2026-11-05). The policy
 * was a static `script-src 'self' 'unsafe-inline'`, which let ANY inline
 * script run — the rule that turns an injected `<script>` into an attack.
 */
const page = (cookie?: string) =>
  new NextRequest('https://bpm.grantzou.com/bpm', { headers: cookie ? { cookie } : {} });

function scriptSrc(policy: string): string {
  return policy.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';
}

describe('the page policy', () => {
  it('a page gets a fresh nonce, on the response AND handed to Next on the request', () => {
    const res = proxy(page('NEXT_LOCALE=en'));
    const policy = res.headers.get('Content-Security-Policy') ?? '';
    const nonce = /'nonce-([^']+)'/.exec(scriptSrc(policy))?.[1];
    expect(nonce, 'script-src carries a nonce').toBeTruthy();
    // NextResponse.next({ request: { headers } }) forwards these to rendering.
    expect(res.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(res.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
  });

  it('the nonce is new on every request', () => {
    const a = proxy(page('NEXT_LOCALE=en')).headers.get('Content-Security-Policy');
    const b = proxy(page('NEXT_LOCALE=en')).headers.get('Content-Security-Policy');
    expect(a).not.toBe(b);
  });

  it('a first visit (the locale cookie set here) is nonced too', () => {
    const res = proxy(page());
    expect(scriptSrc(res.headers.get('Content-Security-Policy') ?? '')).toMatch(/'nonce-/);
    expect(res.cookies.get('NEXT_LOCALE')).toBeTruthy();
  });

  it('keeps the rest of the policy', () => {
    const policy = buildCsp({ nonce: 'abc', dev: false });
    for (const d of ["frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'", "default-src 'self'"]) {
      expect(policy).toContain(d);
    }
    // 'unsafe-inline' stays only as the fallback a nonce-aware browser ignores.
    expect(scriptSrc(policy)).toBe("script-src 'self' 'nonce-abc' 'unsafe-inline'");
  });
});

describe('the one place it is set', () => {
  it('the proxy runs on the home page itself, not only on paths under it', () => {
    // Under the /bpm basePath the catch-all compiles to ^/bpm/…, which never
    // matched /bpm — the app's one page went without the proxy (2026-11-05).
    expect(config.matcher).toContain('/');
  });

  it('next.config.js no longer sends a static policy that would stack on top', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('../next.config.js') as { headers: () => Promise<Array<{ headers: Array<{ key: string }> }>> };
    const keys = (await cfg.headers()).flatMap((r) => r.headers.map((h) => h.key));
    expect(keys).not.toContain('Content-Security-Policy');
  });

  it('the launch screen’s inline script carries the nonce', () => {
    const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');
    expect(layout).toContain("(await headers()).get('x-nonce')");
    expect(layout).toMatch(/<script\s+nonce=\{nonce\}/);
    // Every inline <script> in the app is the layout's one.
    expect(layout.match(/<script\b/g)?.length).toBe(1);
  });
});
