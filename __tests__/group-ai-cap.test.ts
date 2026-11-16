import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CLUB_AI_DAILY, takeClubAiCall } from '@/lib/aiBudget';
import { POST as scanPOST } from '@/app/api/stringing/stocktake/scan/route';
import { POST as claudePOST } from '@/app/api/claude/route';
import { PATCH as stringsPATCH } from '@/app/api/stringing/strings/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetMockStore, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * The two-club gate for the AI allowance (docs/plans/club-ai-cap.md): one
 * club using up its shelf photos never refuses another club's, the caller's
 * own club's allowance does; and the writing helper answers the operator
 * alone (Grant, 2026-11-16: "This is only for me").
 */

const parse = vi.fn();
const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error { status = 500; }
  return {
    default: class {
      static APIError = APIError;
      beta = { messages: { parse: (...a: unknown[]) => parse(...a) } };
      messages = { create: (...a: unknown[]) => create(...a) };
    },
  };
});

const SCAN = 'http://localhost:3000/api/stringing/stocktake/scan';
const scan = () => scanPOST(makeAdminRequest('POST', SCAN, { image: 'aGVsbG8=', mediaType: 'image/jpeg' }));

describe('the photo allowance is per club', () => {
  beforeEach(async () => {
    resetMockStore();
    __resetCatalogSeedForTests();
    setupAdminPin();
    parse.mockReset();
    parse.mockRejectedValue(new Error('not reached in these tests past the gate'));
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    await seedTestAdminMember();
    await stringsPATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/stringing/strings', { strings: ['BG80'] }));
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("another club's used-up allowance does not refuse BPM", async () => {
    for (let i = 0; i < CLUB_AI_DAILY.stocktake; i++) takeClubAiCall('other', 'stocktake');
    const res = await scan();
    expect(res.status).not.toBe(429);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("BPM's own used-up allowance refuses BPM, before the model is called", async () => {
    for (let i = 0; i < CLUB_AI_DAILY.stocktake; i++) takeClubAiCall('bpm', 'stocktake');
    const res = await scan();
    expect(res.status).toBe(429);
    expect(parse).not.toHaveBeenCalled();
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
