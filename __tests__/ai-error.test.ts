import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { describeAiFailure } from '@/lib/aiError';

/**
 * Regression suite for the swallowed-error bug: `POST /api/claude` answered
 * every failure with a flat "AI request failed", so a retired model ID looked
 * identical to a rate limit, a bad key, and a network blip. The admin — the one
 * person who could fix any of them — was told nothing.
 */

/** Shape of an Anthropic SDK error: an HTTP status plus the nested API body. */
function apiError(status: number, message: string) {
  return Object.assign(new Error(`${status} ${message}`), {
    status,
    error: { error: { message } },
  });
}

const KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  // Every case below assumes a configured server; the missing-key case sets its own.
  process.env.ANTHROPIC_API_KEY = 'sk-test-placeholder';
});

afterEach(() => {
  if (KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = KEY;
});

describe('describeAiFailure', () => {
  it('names a retired model instead of hiding it — the exact production outage', () => {
    const r = describeAiFailure(apiError(404, 'model: claude-sonnet-4-20250514'));
    expect(r.kind).toBe('config');
    expect(r.message).toContain('retired');
    // The specific model must reach the admin; that string was the whole diagnosis.
    expect(r.message).toContain('claude-sonnet-4-20250514');
  });

  it('reports a rejected API key as a server config problem, not a 401 to the caller', () => {
    const r = describeAiFailure(apiError(401, 'invalid x-api-key'));
    expect(r.kind).toBe('config');
    // The admin already authenticated — echoing 401 would blame the wrong party.
    expect(r.status).toBe(500);
    expect(r.message).toContain('API key');
  });

  it('passes a rate limit through as 429 so it reads as retryable', () => {
    const r = describeAiFailure(apiError(429, 'rate_limit_error'));
    expect(r).toMatchObject({ kind: 'transient', status: 429 });
    expect(r.message).toMatch(/try again/i);
  });

  it('maps upstream 5xx and overload to 503', () => {
    for (const s of [500, 502, 503, 529]) {
      expect(describeAiFailure(apiError(s, 'overloaded_error'))).toMatchObject({
        kind: 'transient',
        status: 503,
      });
    }
  });

  it('handles a transport failure that carries no HTTP status', () => {
    const r = describeAiFailure(new Error('getaddrinfo ENOTFOUND api.anthropic.com'));
    expect(r).toMatchObject({ kind: 'transient', status: 503 });
    expect(r.message).toContain('ENOTFOUND');
  });

  it('calls out a missing API key before anything else', () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = describeAiFailure(apiError(401, 'invalid x-api-key'));
    expect(r.kind).toBe('config');
    expect(r.message).toContain('ANTHROPIC_API_KEY');
  });

  it('caps reflected upstream text so a huge body cannot be echoed wholesale', () => {
    const r = describeAiFailure(apiError(400, 'x'.repeat(5000)));
    expect(r.message.length).toBeLessThan(300);
    expect(r.message).toContain('…');
  });

  it('never returns an empty message, whatever it is handed', () => {
    for (const junk of [null, undefined, 0, '', {}, [], new Error('')]) {
      const r = describeAiFailure(junk);
      expect(r.message.trim().length).toBeGreaterThan(0);
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
  });
});
