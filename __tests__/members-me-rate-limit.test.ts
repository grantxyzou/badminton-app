// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/members/me/route';
import { NextRequest } from 'next/server';
import { resetMockStore } from './helpers';

/**
 * Over the limit, the probe answers 429 — never a 200 that says `hasPin:
 * false`. The client hooks treat a non-ok status as UNKNOWN; a 200 with the
 * default body was read as "no account", and rendered the anonymous sign-up
 * form to a member who has a PIN the moment a gym's shared address ran out
 * of probes.
 */
function probe(name: string, ip: string): Promise<Response> {
  return GET(
    new NextRequest(new URL(`/api/members/me?name=${encodeURIComponent(name)}`, 'http://localhost/bpm'), {
      headers: { 'x-client-ip': ip },
    }),
  );
}

describe('GET /api/members/me rate limit', () => {
  beforeEach(() => resetMockStore());

  it('answers 429 past ten probes of one name from one address', async () => {
    const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 10; i++) expect((await probe('Lin', ip)).status).not.toBe(429);
    const over = await probe('Lin', ip);
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: 'rate_limited' });
  });

  it('the per-name bucket does not starve a different name on the same address', async () => {
    const ip = `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 10; i++) await probe('Lin', ip);
    expect((await probe('Lin', ip)).status).toBe(429);
    expect((await probe('Viktor', ip)).status).not.toBe(429);
  });

  it('the coarse per-address bucket still closes after 120 probes', async () => {
    const ip = `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 120; i++) await probe(`n${i}`, ip);
    expect((await probe('fresh', ip)).status).toBe(429);
  });
});
