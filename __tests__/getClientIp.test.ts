import { describe, it, expect, afterEach } from 'vitest';
import { getClientIp } from '../lib/rateLimit';

function reqWith(headers: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/anything', { headers });
}

describe('getClientIp — default (Azure) behaviour', () => {
  afterEach(() => {
    delete process.env.TRUSTED_IP_HEADER;
  });

  it('prefers x-client-ip', () => {
    expect(getClientIp(reqWith({ 'x-client-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }))).toBe(
      '1.2.3.4',
    );
  });

  it('falls back to the first x-forwarded-for entry', () => {
    expect(getClientIp(reqWith({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }))).toBe('5.6.7.8');
  });

  it('returns "unknown" when no IP headers are present', () => {
    expect(getClientIp(reqWith({}))).toBe('unknown');
  });
});

describe('getClientIp — TRUSTED_IP_HEADER override', () => {
  afterEach(() => {
    delete process.env.TRUSTED_IP_HEADER;
  });

  it('trusts ONLY the configured header and ignores spoofable x-forwarded-for', () => {
    process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip';
    const ip = getClientIp(
      reqWith({
        'cf-connecting-ip': '203.0.113.7',
        'x-client-ip': '6.6.6.6',
        'x-forwarded-for': '6.6.6.6',
      }),
    );
    expect(ip).toBe('203.0.113.7');
  });

  it('does NOT fall back to x-forwarded-for when the trusted header is absent', () => {
    process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip';
    // An attacker can set x-forwarded-for, but with a pinned trusted header it
    // must be ignored — otherwise rate limiting is bypassable by spoofing.
    expect(getClientIp(reqWith({ 'x-forwarded-for': '6.6.6.6' }))).toBe('unknown');
  });

  it('is case-insensitive about the configured header name', () => {
    process.env.TRUSTED_IP_HEADER = 'CF-Connecting-IP';
    expect(getClientIp(reqWith({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
  });
});
