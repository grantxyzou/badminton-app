import { describe, it, expect, afterEach } from 'vitest';
import { getClientIp } from '../lib/rateLimit';

/**
 * What keys a rate limit is a security decision, so it is pinned here.
 *
 * `getClientIp` used to read `X-Client-IP` FIRST, on a comment asserting that
 * Azure App Service sets it and strips any caller-supplied value. Both halves
 * were false: Azure sets no such header, and therefore strips nothing. The
 * caller's value arrived intact and was trusted ahead of the real client
 * address, so rotating one byte of it bought a fresh allowance on every per-IP
 * limit in the app — the 5/hr sign-in throttle, the recovery-code endpoint, and
 * the two PIN-verification limiters alike.
 *
 * Measured against production on 2026-09-12 rather than argued: 121 requests
 * under one forged `X-Client-IP` exhausted a 120/hr bucket at exactly the 121st,
 * a second forged value answered from a fresh bucket, and sending no header at
 * all was a third.
 *
 * The second half of that measurement was over-read, and the correction is the
 * reason for the `stripPort` cases below. It concluded from "121 forged
 * `X-Forwarded-For` requests landed in ONE bucket" that Azure overwrites the
 * header. Run over a single keep-alive connection that observation cannot
 * distinguish an overwritten header from a key that varies per CONNECTION.
 * Azure does overwrite it — but it writes `<ip>:<port>`, so the key was varying
 * too, and the probe was blind to both.
 *
 * Note the shape of the original bug, because it is the reason for this file:
 * the only writer of `X-Client-IP` anywhere in the repository is the test
 * suite, which uses it for per-test bucket isolation. Production was trusting a
 * test fixture. The suite keeps that isolation through `TRUSTED_IP_HEADER`,
 * named in `vitest.config.ts`, which is also what these cases exercise.
 */

const ORIGINAL = process.env.TRUSTED_IP_HEADER;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TRUSTED_IP_HEADER;
  else process.env.TRUSTED_IP_HEADER = ORIGINAL;
});

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://example.test/api/anything', { headers });
}

describe('getClientIp', () => {
  describe('with no TRUSTED_IP_HEADER set (the production shape)', () => {
    // The suite sets TRUSTED_IP_HEADER globally, so unset it to see what a
    // deployed instance actually does.
    function unset() {
      delete process.env.TRUSTED_IP_HEADER;
    }

    it('IGNORES X-Client-IP — the header Azure never sets and never strips', () => {
      unset();
      const ip = getClientIp(reqWith({ 'X-Client-IP': '203.0.113.11' }));
      expect(ip).not.toBe('203.0.113.11');
      expect(ip).toBe('unknown');
    });

    it('does not let X-Client-IP override the real forwarded address', () => {
      unset();
      // The exploit shape: a caller supplies both, hoping the spoofable one wins.
      const ip = getClientIp(
        reqWith({ 'X-Client-IP': '203.0.113.11', 'X-Forwarded-For': '198.51.100.7' }),
      );
      expect(ip).toBe('198.51.100.7');
    });

    it('rotating X-Client-IP cannot mint a second bucket', () => {
      unset();
      const a = getClientIp(
        reqWith({ 'X-Client-IP': '203.0.113.11', 'X-Forwarded-For': '198.51.100.7' }),
      );
      const b = getClientIp(
        reqWith({ 'X-Client-IP': '203.0.113.22', 'X-Forwarded-For': '198.51.100.7' }),
      );
      expect(a).toBe(b);
    });

    it('keys on the FIRST X-Forwarded-For entry, which Azure overwrites', () => {
      unset();
      expect(getClientIp(reqWith({ 'X-Forwarded-For': '198.51.100.7, 10.0.0.1' })))
        .toBe('198.51.100.7');
    });

    it('answers a constant when no forwarded header is present', () => {
      unset();
      expect(getClientIp(reqWith({}))).toBe('unknown');
    });
  });

  describe('with TRUSTED_IP_HEADER set', () => {
    it('reads only the named header', () => {
      process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip';
      expect(
        getClientIp(reqWith({ 'CF-Connecting-IP': '198.51.100.9', 'X-Forwarded-For': '203.0.113.5' })),
      ).toBe('198.51.100.9');
    });

    it('does NOT fall back to X-Forwarded-For when the named header is absent', () => {
      // Falling back would reopen the hole on a deployment that set this
      // precisely because its proxy does not guarantee X-Forwarded-For.
      process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip';
      expect(getClientIp(reqWith({ 'X-Forwarded-For': '203.0.113.5' }))).toBe('unknown');
    });

    it('is what lets the suite keep per-test buckets on X-Client-IP', () => {
      process.env.TRUSTED_IP_HEADER = 'x-client-ip';
      expect(getClientIp(reqWith({ 'X-Client-IP': '203.0.113.11' }))).toBe('203.0.113.11');
    });
  });
  describe('the port Azure appends to X-Forwarded-For', () => {
    // App Service writes `X-Forwarded-For: <client-ip>:<source-port>`. The port
    // changes on every TCP connection, so keying on the raw entry gave each new
    // connection a fresh bucket. Measured on 2026-09-13: four connections each
    // got a clean 30 of a 30/min limit, while 40 requests over one connection
    // throttled at exactly 30.
    function unset() {
      delete process.env.TRUSTED_IP_HEADER;
    }

    it('strips the port so one address is ONE bucket', () => {
      unset();
      expect(getClientIp(reqWith({ 'X-Forwarded-For': '203.0.113.5:54321' })))
        .toBe('203.0.113.5');
    });

    it('gives two connections from the same address the same key', () => {
      unset();
      const a = getClientIp(reqWith({ 'X-Forwarded-For': '203.0.113.5:54321' }));
      const b = getClientIp(reqWith({ 'X-Forwarded-For': '203.0.113.5:61002' }));
      expect(a).toBe(b);
    });

    it('strips the port from the FIRST entry of a list', () => {
      unset();
      expect(
        getClientIp(reqWith({ 'X-Forwarded-For': '203.0.113.5:1111, 10.0.0.1:2222' })),
      ).toBe('203.0.113.5');
    });

    it('leaves a bare IPv6 address whole — it is all colons and no port', () => {
      unset();
      // A naive split(':') would key every IPv6 client on '2001', collapsing
      // the entire internet into one bucket.
      expect(getClientIp(reqWith({ 'X-Forwarded-For': '2001:db8::1' })))
        .toBe('2001:db8::1');
    });

    it('unwraps a bracketed IPv6 address, with or without a port', () => {
      unset();
      expect(getClientIp(reqWith({ 'X-Forwarded-For': '[2001:db8::1]:443' })))
        .toBe('2001:db8::1');
      expect(getClientIp(reqWith({ 'X-Forwarded-For': '[2001:db8::1]' })))
        .toBe('2001:db8::1');
    });

    it('does not treat a non-numeric suffix as a port', () => {
      unset();
      expect(getClientIp(reqWith({ 'X-Forwarded-For': 'host:notaport' })))
        .toBe('host:notaport');
    });

    it('strips the port on the TRUSTED_IP_HEADER path too', () => {
      process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip';
      expect(getClientIp(reqWith({ 'CF-Connecting-IP': '198.51.100.9:5000' })))
        .toBe('198.51.100.9');
    });

    it('keeps the suite\'s own per-test fixtures intact', () => {
      // Helpers send a bare address with no port; stripping must be a no-op.
      process.env.TRUSTED_IP_HEADER = 'x-client-ip';
      expect(getClientIp(reqWith({ 'X-Client-IP': '10.0.0.42' }))).toBe('10.0.0.42');
    });
  });
});
