import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit } from '../lib/rateLimit';

/**
 * #80's decided shape: accept the in-memory limiter's cold-start reset (friend-
 * group scale, no real attackers today), but make a real attempt VISIBLE —
 * without writing personal data to the logs, and without a flood writing one
 * line per request.
 */
describe('checkRateLimit monitoring', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does not log an allowed request', () => {
    expect(checkRateLimit('mon-allowed-key', 5, 60_000)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs the first refusal with the bucket, the limit and a hash — a 3/hr bucket loses nothing', () => {
    const key = 'mon-first:lin@example.com:203.0.113.9';
    expect(checkRateLimit(key, 1, 60_000)).toBe(true);
    expect(checkRateLimit(key, 1, 60_000)).toBe(false);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [msg, payload] = warnSpy.mock.calls[0];
    expect(msg).toBe('[rate-limit] refused');
    expect(payload).toMatchObject({ bucket: 'mon-first', maxRequests: 1, windowMs: 60_000, refusedThisWindow: 1 });
    expect((payload as { keyHash: string }).keyHash).toMatch(/^[0-9a-f]{12}$/);
  });

  // Keys carry an email or a roster name next to an IP. Logging them on every
  // refusal writes personal data to App Service logs for no reason.
  it('never logs the email, name or IP inside a key', () => {
    const key = 'auth-signin:lin@example.com:203.0.113.9';
    checkRateLimit(key, 1, 60_000);
    checkRateLimit(key, 1, 60_000);
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain('lin@example.com');
    expect(logged).not.toContain('203.0.113.9');
  });

  it('a sustained flood logs on refusals 1, 2, 4, 8 — not once per request — with a stable hash', () => {
    const key = 'mon-flood:198.51.100.7';
    checkRateLimit(key, 1, 60_000); // the one allowed request
    for (let i = 0; i < 10; i++) checkRateLimit(key, 1, 60_000); // 10 refusals

    expect(warnSpy).toHaveBeenCalledTimes(4);
    type Logged = { refusedThisWindow: number; keyHash: string };
    const payloads: Logged[] = warnSpy.mock.calls.map((c: unknown[]) => c[1] as Logged);
    expect(payloads.map((p: Logged) => p.refusedThisWindow)).toEqual([1, 2, 4, 8]);
    expect(new Set(payloads.map((p: Logged) => p.keyHash)).size).toBe(1);
  });

  // An unsalted sha256 of `bucket:ip` is reversible by enumerating IPv4, and
  // the bucket is logged in the clear beside it. The hash must not be one.
  it('the key hash is salted — not a plain sha256 anyone can reverse', async () => {
    const { createHash } = await import('node:crypto');
    const key = 'mon-salted:203.0.113.9';
    checkRateLimit(key, 1, 60_000);
    checkRateLimit(key, 1, 60_000);
    const { keyHash } = warnSpy.mock.calls[0][1] as { keyHash: string };
    expect(keyHash).not.toBe(createHash('sha256').update(key).digest('hex').slice(0, 12));
  });

  it('never interpolates the key into the message string', () => {
    const key = 'mon-injection-key:%s:%o';
    checkRateLimit(key, 1, 60_000);
    checkRateLimit(key, 1, 60_000);
    const [msg] = warnSpy.mock.calls[0];
    expect(msg).toBe('[rate-limit] refused');
  });
});
