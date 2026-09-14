import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit } from '../lib/rateLimit';

/**
 * #80's decided shape: accept the in-memory limiter's cold-start reset (friend-
 * group scale, no real attackers today), but make a real attempt VISIBLE.
 *
 * The lowest limits in this app are 3-5/hr (`auth-forgot`, `admin`, `signup`,
 * `password-reset`, `member-delete`, `groups-create`). A sampled or debounced
 * log line would show nothing on a bucket that size — three or five refused
 * requests IS the whole signal. So every refusal logs, not a rate of them.
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
    const ok = checkRateLimit('mon-allowed-key', 5, 60_000);
    expect(ok).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs a refusal, naming the key and the limit — not a format string', () => {
    const key = 'mon-refused-key';
    expect(checkRateLimit(key, 1, 60_000)).toBe(true);
    expect(checkRateLimit(key, 1, 60_000)).toBe(false);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [msg, payload] = warnSpy.mock.calls[0];
    expect(msg).toBe('[rate-limit] refused');
    expect(payload).toMatchObject({ key, maxRequests: 1, windowMs: 60_000 });
  });

  it('logs EVERY refusal, not just the first — a 3/hr bucket has no room to sample', () => {
    const key = 'mon-repeat-key';
    checkRateLimit(key, 1, 60_000); // consumes the one allowed slot
    checkRateLimit(key, 1, 60_000); // refusal 1
    checkRateLimit(key, 1, 60_000); // refusal 2
    checkRateLimit(key, 1, 60_000); // refusal 3

    expect(warnSpy).toHaveBeenCalledTimes(3);
    for (const call of warnSpy.mock.calls) {
      expect(call[0]).toBe('[rate-limit] refused');
      expect(call[1]).toMatchObject({ key });
    }
  });

  it('never interpolates the key into the message string', () => {
    // A key can carry a name or email the caller controls (e.g.
    // `recover:${name}:${ip}`). console.warn(str, obj) treats `str` as a
    // FORMAT string, so a key landing inside it — rather than in the payload
    // object — would let that name inject %s/%o or a newline. Same class of
    // bug __tests__/group-leak logging guards against.
    const key = 'mon-injection-key:%s:%o';
    checkRateLimit(key, 1, 60_000);
    checkRateLimit(key, 1, 60_000);

    const [msg] = warnSpy.mock.calls[0];
    expect(msg).toBe('[rate-limit] refused');
    expect(msg).not.toContain('%s');
  });
});
