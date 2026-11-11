import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resettleSession, RESETTLE_FAILED } from '../lib/resettleSession';

/**
 * The client half of re-freezing a settled bill: ONE request since
 * 2026-11-05 (`POST /api/session/settle { resettle: true }`), so the bill can
 * no longer be left thawed between a DELETE and a POST. A failure throws — a
 * caller that swallowed it would reload and show live numbers as frozen.
 */
function res(status: number) {
  return { ok: status >= 200 && status < 300, status } as Response;
}

describe('resettleSession', () => {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  let answers: Response[];

  beforeEach(() => {
    calls.length = 0;
    answers = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: typeof init?.body === 'string' ? init.body : undefined });
      return answers.shift() ?? res(500);
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('issues ONE POST with resettle: true against the named session', async () => {
    answers = [res(200)];
    await resettleSession('session-2026-09-24');
    expect(calls.map((c) => c.method)).toEqual(['POST']);
    expect(calls[0].url).toContain('?sessionId=session-2026-09-24');
    expect(JSON.parse(calls[0].body!)).toEqual({ resettle: true });
  });

  it('omits the query when no session id is given (active session)', async () => {
    answers = [res(200)];
    await resettleSession(null);
    expect(calls[0].url).not.toContain('sessionId=');
  });

  it('THROWS when the server refuses or fails', async () => {
    answers = [res(409)];
    await expect(resettleSession('s')).rejects.toThrow(RESETTLE_FAILED);
    answers = [res(500)];
    await expect(resettleSession('s')).rejects.toThrow(RESETTLE_FAILED);
  });
});
