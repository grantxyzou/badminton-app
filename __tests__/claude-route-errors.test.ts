import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { setupAdminPin, resetMockStore, seedAdminMember, makeAdminRequest, makeRequest, adminCookieValue } from './helpers';

/**
 * Route-level cover for the swallowed-error fix. The unit tests in
 * ai-error.test.ts pin the mapping; these pin that the route USES it, and —
 * just as importantly — that non-AI failures are not dressed up as AI outages.
 *
 * The SDK is mocked so no network call happens and no API key is needed.
 */

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...args: unknown[]) => create(...args) };
  },
}));

const URL = 'http://localhost/api/claude';

async function post(body: Record<string, unknown>, admin = true) {
  const { POST } = await import('@/app/api/claude/route');
  return POST(admin ? makeAdminRequest('POST', URL, body) : makeRequest('POST', URL, body));
}

/** The helpers JSON.stringify their body, so a malformed one is built by hand. */
async function postRaw(raw: string) {
  const { POST } = await import('@/app/api/claude/route');
  const req = new NextRequest(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `admin_session=${adminCookieValue()}` },
    body: raw,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return POST(req);
}

describe('POST /api/claude — failures say why', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
    create.mockReset();
    process.env.ANTHROPIC_API_KEY = 'sk-test-placeholder';
  });

  it('surfaces a retired model instead of a flat "AI request failed"', async () => {
    create.mockRejectedValue(
      Object.assign(new Error('404'), {
        status: 404,
        error: { error: { message: 'model: claude-sonnet-4-20250514' } },
      }),
    );
    const res = await post({ prompt: 'polish this' });
    const body = await res.json();

    expect(body.error).not.toBe('AI request failed');
    expect(body.error).toContain('claude-sonnet-4-20250514');
    expect(res.status).toBe(500);
  });

  it('returns 429 — not 500 — when the AI is rate-limited upstream', async () => {
    create.mockRejectedValue(
      Object.assign(new Error('429'), { status: 429, error: { error: { message: 'rate_limit_error' } } }),
    );
    const res = await post({ prompt: 'polish this' });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/try again/i);
  });

  it('does NOT describe a malformed body as an AI failure', async () => {
    const res = await postRaw('{not json');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Invalid JSON body');
    // The AI must never have been called for a bad request.
    expect(create).not.toHaveBeenCalled();
  });

  it('still rejects an empty prompt as a 400 without calling the AI', async () => {
    const res = await post({ prompt: '   ' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Prompt required');
    expect(create).not.toHaveBeenCalled();
  });

  it('returns text on success', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'Polished.' }] });
    const res = await post({ prompt: 'polish this' });
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe('Polished.');
  });

  it('tolerates an empty content array rather than throwing a fake AI error', async () => {
    create.mockResolvedValue({ content: [] });
    const res = await post({ prompt: 'polish this' });
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe('');
  });

  it('still refuses non-admins', async () => {
    const res = await post({ prompt: 'polish this' }, false);
    expect(res.status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });
});
