import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { CLUB_AI_DAILY, PERSON_AI_DAILY, takeClubAiCall, takeMemberAiCall, takePersonAiCall } from '@/lib/aiBudget';
import { PATCH as stringsPATCH } from '@/app/api/stringing/strings/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetMockStore, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * The per-club AI allowance (docs/plans/club-ai-cap.md; Grant, 2026-11-16:
 * "add the per-club AI cap"). Every AI feature runs on one key; this is the
 * ceiling per club per feature per day.
 */

const parse = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error { status = 500; }
  return { default: class { static APIError = APIError; beta = { messages: { parse: (...a: unknown[]) => parse(...a) } }; messages = { create: vi.fn() }; } };
});

describe('the allowance', () => {
  it('lets a club through up to its number, then refuses', () => {
    for (let i = 0; i < CLUB_AI_DAILY.stocktake; i++) expect(takeClubAiCall('club-a', 'stocktake')).toBe(true);
    expect(takeClubAiCall('club-a', 'stocktake')).toBe(false);
  });

  it('is per club, and per feature', () => {
    for (let i = 0; i < CLUB_AI_DAILY.stocktake; i++) takeClubAiCall('club-b', 'stocktake');
    expect(takeClubAiCall('club-b', 'stocktake')).toBe(false);
    // Another club is untouched, and so is the same club's Stats read.
    expect(takeClubAiCall('club-c', 'stocktake')).toBe(true);
    expect(takeClubAiCall('club-b', 'insight')).toBe(true);
  });

  it('carries the numbers Grant set (2026-11-16)', () => {
    expect(CLUB_AI_DAILY).toEqual({ insight: 100, fitVerdict: 100, stocktake: 10 });
    expect(PERSON_AI_DAILY).toEqual({ insight: 5, fitVerdict: 10 });
    // The writing helper is the operator's alone: no club allowance exists for it.
    expect(Object.keys(CLUB_AI_DAILY)).not.toContain('writing');
  });

  it('gives a person their own allowance, separate from their neighbour', () => {
    for (let i = 0; i < PERSON_AI_DAILY.insight; i++) expect(takePersonAiCall('m-1', 'insight')).toBe(true);
    expect(takePersonAiCall('m-1', 'insight')).toBe(false);
    expect(takePersonAiCall('m-2', 'insight')).toBe(true);
    expect(takePersonAiCall('m-1', 'fitVerdict')).toBe(true);
  });

  it("checks the person first, so a person over their own never spends the club's", () => {
    for (let i = 0; i < PERSON_AI_DAILY.fitVerdict; i++) expect(takeMemberAiCall('club-d', 'm-3', 'fitVerdict')).toBeNull();
    expect(takeMemberAiCall('club-d', 'm-3', 'fitVerdict')).toBe('person');
    expect(takeMemberAiCall('club-d', 'm-3', 'fitVerdict')).toBe('person');
    // The club spent exactly ten, not twelve.
    let left = 0;
    while (takeClubAiCall('club-d', 'fitVerdict')) left++;
    expect(left).toBe(CLUB_AI_DAILY.fitVerdict - PERSON_AI_DAILY.fitVerdict);
  });

  it('answers club when the club is out and the person is not', () => {
    for (let i = 0; i < CLUB_AI_DAILY.insight; i++) takeClubAiCall('club-e', 'insight');
    expect(takeMemberAiCall('club-e', 'm-4', 'insight')).toBe('club');
  });
});

describe('every AI caller spends from it before calling the model', () => {
  const CALLERS: Array<[string, string, string]> = [
    ['app/api/stats/insight/route.ts', 'takeMemberAiCall(', 'insight'],
    ['app/api/equipment/fit-verdict/route.ts', 'takeMemberAiCall(', 'fitVerdict'],
    ['app/api/stringing/stocktake/scan/route.ts', 'takeClubAiCall(', 'stocktake'],
  ];
  it.each(CALLERS)('%s takes its allowance ahead of the model call', (file, fn, feature) => {
    const src = readFileSync(file, 'utf8');
    const take = src.indexOf(fn);
    expect(take, `${file} never calls ${fn}`).toBeGreaterThan(-1);
    expect(src).toContain(`'${feature}')`);
    const call = Math.max(src.indexOf('.messages.create('), src.indexOf('.messages.parse('));
    expect(call).toBeGreaterThan(take);
  });

  it('the writing helper is the operator\'s, checked before the model call', () => {
    const src = readFileSync('app/api/claude/route.ts', 'utf8');
    const gate = src.indexOf('await isOperator(req)');
    expect(gate).toBeGreaterThan(-1);
    expect(src.indexOf('.messages.create(')).toBeGreaterThan(gate);
    expect(src).not.toContain('isAdminAuthedWithMember(req)');
  });
});

describe('a club over its photo allowance', () => {
  beforeEach(async () => {
    resetMockStore();
    __resetCatalogSeedForTests();
    setupAdminPin();
    parse.mockReset();
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    await seedTestAdminMember();
    await stringsPATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/stringing/strings', { strings: ['BG80'] }));
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('is told to count by hand, and the model is never called', async () => {
    for (let i = 0; i < CLUB_AI_DAILY.stocktake; i++) takeClubAiCall('bpm', 'stocktake');
    const { POST } = await import('@/app/api/stringing/stocktake/scan/route');
    const res = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/stringing/stocktake/scan', { image: 'aGVsbG8=', mediaType: 'image/jpeg' }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('club_ai_limit');
    expect(parse).not.toHaveBeenCalled();
  });
});
