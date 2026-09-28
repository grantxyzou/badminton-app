import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { resetMockStore } from './helpers';

/**
 * Security rule 4, observed rather than read: a coarse per-IP limiter runs
 * BEFORE `req.json()` on the two routes whose precise limiter is keyed on a
 * value out of the body (the caller-chosen name). Keyed that way alone, every
 * new name was a fresh allowance — so the body is sent MALFORMED here: if the
 * parse ran first the route would answer 400 forever and never 429.
 */
function malformed(url: string, ip: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-IP': ip },
    body: '{not json',
  });
}

async function hammer(handler: (r: NextRequest) => Promise<Response>, url: string, ip: string, n: number) {
  let last = 0;
  for (let i = 0; i < n; i++) last = (await handler(malformed(url, ip))).status;
  return last;
}

describe('coarse per-IP limiter runs before the body is parsed', () => {
  beforeEach(() => resetMockStore());

  it('POST /api/players/recover: 20/hr per IP, before any scrypt', async () => {
    const { POST } = await import('../app/api/players/recover/route');
    const ip = '198.51.100.7';
    expect(await hammer(POST, 'http://localhost/api/players/recover', ip, 20)).toBe(400);
    expect(await hammer(POST, 'http://localhost/api/players/recover', ip, 1)).toBe(429);
  });

  it('POST /api/members/access-request/claim: 200/min per IP', async () => {
    const { POST } = await import('../app/api/members/access-request/claim/route');
    const ip = '198.51.100.8';
    expect(await hammer(POST, 'http://localhost/api/members/access-request/claim', ip, 200)).toBe(400);
    expect(await hammer(POST, 'http://localhost/api/members/access-request/claim', ip, 1)).toBe(429);
  });
});
