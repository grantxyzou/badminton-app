import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resettleSession, RESETTLE_FAILED } from '../lib/resettleSession';

/**
 * The DELETE+POST pair that re-freezes a settled bill. The property under
 * test is the one `PaymentsCard` used to lack: a DELETE that lands without
 * its POST leaves the session UNSETTLED, so that case must throw — a caller
 * that swallowed it reloaded and showed live numbers as if they were frozen.
 */
function res(status: number) {
  return { ok: status >= 200 && status < 300, status } as Response;
}

describe('resettleSession', () => {
  const calls: Array<{ url: string; method?: string }> = [];
  let answers: Response[];

  beforeEach(() => {
    calls.length = 0;
    answers = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return answers.shift() ?? res(500);
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('issues DELETE then POST against the named session', async () => {
    answers = [res(200), res(200)];
    await resettleSession('session-2026-09-24');
    expect(calls.map((c) => c.method)).toEqual(['DELETE', 'POST']);
    expect(calls[0].url).toContain('?sessionId=session-2026-09-24');
    expect(calls[1].url).toContain('?sessionId=session-2026-09-24');
  });

  it('omits the query when no session id is given (active session)', async () => {
    answers = [res(200), res(200)];
    await resettleSession(null);
    expect(calls[0].url).not.toContain('sessionId=');
  });

  it('THROWS when the DELETE landed but the POST failed — the bill is thawed', async () => {
    answers = [res(200), res(400)];
    await expect(resettleSession('s')).rejects.toThrow(RESETTLE_FAILED);
    expect(calls).toHaveLength(2);
  });

  it('throws when the DELETE itself fails, without attempting the POST', async () => {
    answers = [res(500)];
    await expect(resettleSession('s')).rejects.toThrow(RESETTLE_FAILED);
    expect(calls).toHaveLength(1);
  });

  it('treats a 404 on DELETE as "was not settled" and still POSTs', async () => {
    answers = [res(404), res(200)];
    await expect(resettleSession('s')).resolves.toBeUndefined();
    expect(calls.map((c) => c.method)).toEqual(['DELETE', 'POST']);
  });
});
