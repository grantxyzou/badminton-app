import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CLUB_AI_DAILY, takeClubAiCall } from '@/lib/aiBudget';
import { POST } from '@/app/api/claude/route';
import { setupAdminPin, resetMockStore, seedAdminMember, makeAdminRequest } from './helpers';

/**
 * The two-club gate for the AI allowance (docs/plans/club-ai-cap.md): one
 * club using up its writing help never refuses another club's, and the
 * caller's own club's allowance does refuse it.
 */

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...args: unknown[]) => create(...args) };
  },
}));

const URL = 'http://localhost/api/claude';
// vi.mock is hoisted above this import, so the route gets the mocked SDK.
const post = () => POST(makeAdminRequest('POST', URL, { prompt: 'polish this' }));

describe('the writing allowance is per club', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
    create.mockReset();
    create.mockResolvedValue({ content: [{ type: 'text', text: 'Polished.' }] });
    process.env.ANTHROPIC_API_KEY = 'sk-test-placeholder';
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("another club's used-up allowance does not refuse BPM", async () => {
    for (let i = 0; i < CLUB_AI_DAILY.writing; i++) takeClubAiCall('other', 'writing');
    const res = await post();
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("BPM's own used-up allowance refuses BPM, before the model is called", async () => {
    for (let i = 0; i < CLUB_AI_DAILY.writing; i++) takeClubAiCall('bpm', 'writing');
    const res = await post();
    expect(res.status).toBe(429);
    expect(create).not.toHaveBeenCalled();
  });
});
