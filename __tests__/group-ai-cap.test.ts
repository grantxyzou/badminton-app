import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CLUB_AI_DAILY, PERSON_AI_DAILY, takeClubAiCall, takeMemberAiCall } from '@/lib/aiBudget';
import { POST as claudePOST } from '@/app/api/claude/route';
import { resetMockStore, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * The two-club gate for the AI allowance (docs/plans/club-ai-cap.md): one
 * club using up its Stats reads never refuses another club's, and the same
 * person in two clubs still has one personal allowance; and the writing
 * helper answers the operator alone (Grant, 2026-11-16: "This is only for me").
 */

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...a: unknown[]) => create(...a) };
  },
}));

describe('the allowance is per club', () => {
  it("another club's used-up allowance does not refuse BPM; BPM's own does", () => {
    for (let i = 0; i < CLUB_AI_DAILY.insight; i++) takeClubAiCall('other-club', 'insight');
    expect(takeMemberAiCall('bpm-gate', 'm-in-bpm', 'insight')).toBeNull();
    expect(takeMemberAiCall('other-club', 'm-in-other', 'insight')).toBe('club');
  });

  it('a person on two rosters has ONE personal allowance, not one per club', () => {
    for (let i = 0; i < PERSON_AI_DAILY.fitVerdict; i++) {
      expect(takeMemberAiCall(i % 2 === 0 ? 'club-x' : 'club-y', 'm-both', 'fitVerdict')).toBeNull();
    }
    expect(takeMemberAiCall('club-x', 'm-both', 'fitVerdict')).toBe('person');
    expect(takeMemberAiCall('club-y', 'm-both', 'fitVerdict')).toBe('person');
  });
});

describe('the writing helper is the operator\'s', () => {
  const URL = 'http://localhost/api/claude';
  const post = () => claudePOST(makeAdminRequest('POST', URL, { prompt: 'polish this' }));

  beforeEach(async () => {
    resetMockStore();
    setupAdminPin();
    await seedTestAdminMember();
    create.mockReset();
    create.mockResolvedValue({ content: [{ type: 'text', text: 'Polished.' }] });
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPERATOR_MEMBER_IDS;
  });

  it('answers the operator (with the list unset, an admin of BPM)', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('refuses an admin who is not the operator, before the model is called', async () => {
    process.env.OPERATOR_MEMBER_IDS = 'someone-else';
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('operator_only');
    expect(create).not.toHaveBeenCalled();
  });
});
