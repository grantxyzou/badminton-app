import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { resetMockStore, getStore, seedMember, setupAdminPin, makeRequest, memberCookieValue, adminCookieValue, seedTestAdminMember, getTestAdminName } from './helpers';

// The model is mocked: these tests pin what the ROUTE decides, never what a model says.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { GET } from '../app/api/equipment/fit-verdict/route';
import { __resetCatalogSeedForTests } from '../lib/catalogSeed';
import { checkCopy, parseCopy } from '../lib/fitVerdictCopy';
import type { FitFacts } from '../lib/fitVerdict';

const BASE = 'http://localhost:3000/api/equipment/fit-verdict';
const FRAME = 'racket-li-ning-air-force-79';

function asMember(cookieName: string, target: string, extraCookie = '') {
  return makeRequest('GET', `${BASE}?name=${encodeURIComponent(target)}`, undefined, {
    Cookie: `member_session=${memberCookieValue(cookieName)}${extraCookie}`,
  });
}

function reply(obj: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

function seedGear(memberId: string, over: Record<string, unknown> = {}) {
  const store = getStore();
  store['playerGear'] = store['playerGear'] ?? [];
  store['playerGear'] = (store['playerGear'] as { id: string }[]).filter((d) => d.id !== `gear-${memberId}`);
  store['playerGear'].push({
    id: `gear-${memberId}`, memberId, updatedAt: '',
    items: [
      { id: 'r1', catalogId: FRAME, category: 'racket', label: 'Li-Ning Air Force 79' },
      { id: 's1', catalogId: null, category: 'string', label: 'BG65', tensionLbs: 24 },
    ],
    activeRacketId: 'r1',
    fitLevelOverride: '3.2', fitPlayStyle: 'doubles', fitSwing: 'medium', fitGrip: 'G4', fitSoreness: 'none', fitGoal: 'happy',
    ...over,
  });
}

/** A reply that meets the contract for whatever reasons the facts carry. */
function goodReplyFor(facts: FitFacts) {
  return reply({
    headline: 'This racket is on your side',
    body: 'Nothing in your answers argues with it.',
    reasons: facts.reasons.map((_, i) => `Reason ${'abc'[i]}`),
  });
}

describe('GET /api/equipment/fit-verdict', () => {
  beforeEach(() => {
    resetMockStore();
    // The seed is memoised per process; a reset store needs it run again.
    __resetCatalogSeedForTests();
    setupAdminPin();
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.NEXT_PUBLIC_FLAG_FIT_VERDICT = 'true';
  });
  afterAll(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.NEXT_PUBLIC_FLAG_FIT_VERDICT;
  });

  it('is owner only — another member and an admin both get 403', async () => {
    const lin = seedMember('Lin');
    seedMember('Viktor');
    seedGear(lin.id);
    expect((await GET(asMember('Viktor', 'Lin'))).status).toBe(403);
    const admin = makeRequest('GET', `${BASE}?name=Lin`, undefined, { Cookie: `admin_session=${adminCookieValue()}` });
    expect((await GET(admin)).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('an admin signed in only through the admin login still reads their OWN verdict', async () => {
    process.env.NEXT_PUBLIC_FLAG_FIT_VERDICT = 'false';
    await seedTestAdminMember();
    seedGear('member-test-admin');
    const req = makeRequest('GET', `${BASE}?name=${encodeURIComponent(getTestAdminName())}`, undefined, { Cookie: `admin_session=${adminCookieValue()}` });
    expect((await GET(req)).status).toBe(200);
  });

  it('never calls the model with nothing to judge', async () => {
    const lin = seedMember('Lin');
    seedGear(lin.id, { fitSoreness: undefined });
    const body = await (await GET(asMember('Lin', 'Lin'))).json();
    expect(body.facts.state).toBe('insufficient');
    expect(body.copy).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('with the flag off, returns the facts and no words, and calls nothing', async () => {
    process.env.NEXT_PUBLIC_FLAG_FIT_VERDICT = 'false';
    const lin = seedMember('Lin');
    seedGear(lin.id);
    const body = await (await GET(asMember('Lin', 'Lin'))).json();
    expect(body.facts.state).not.toBe('insufficient');
    expect(body.copy).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('writes the words once, serves them from the cache, and rewrites when a fact moves', async () => {
    const lin = seedMember('Lin');
    seedGear(lin.id);
    // Read the facts with the words off, to size a reply that meets the contract.
    process.env.NEXT_PUBLIC_FLAG_FIT_VERDICT = 'false';
    const facts = (await (await GET(asMember('Lin', 'Lin'))).json()).facts as FitFacts;
    process.env.NEXT_PUBLIC_FLAG_FIT_VERDICT = 'true';
    mockCreate.mockResolvedValue(goodReplyFor(facts));

    const first = await (await GET(asMember('Lin', 'Lin'))).json();
    expect(first.copy?.headline).toBe('This racket is on your side');
    expect(first.cached).toBe(false);
    const second = await (await GET(asMember('Lin', 'Lin'))).json();
    expect(second.cached).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // The string is restrung two pounds looser: new facts, new words.
    seedGear(lin.id, { items: [
      { id: 'r1', catalogId: FRAME, category: 'racket', label: 'Li-Ning Air Force 79' },
      { id: 's1', catalogId: null, category: 'string', label: 'BG65', tensionLbs: 21 },
    ] });
    const moved = (await (await GET(asMember('Lin', 'Lin'))).json());
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(moved.facts.currentTensionLbs).toBe(21);
  });

  it('a reply off the contract becomes no words, never a repaired guess', async () => {
    const lin = seedMember('Lin');
    seedGear(lin.id);
    mockCreate.mockResolvedValue(reply({ headline: 'String it at 24 lb', body: 'x', reasons: [] }));
    const body = await (await GET(asMember('Lin', 'Lin'))).json();
    expect(body.copy).toBeNull();
    expect(body.facts.state).not.toBe('insufficient');
  });

  it('a rejected reply is cached for a day, logged by rule, then asked again', async () => {
    const lin = seedMember('Lin');
    seedGear(lin.id);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCreate.mockResolvedValue(reply({ headline: 'x'.repeat(71), body: 'y', reasons: [] }));

    const first = await (await GET(asMember('Lin', 'Lin'))).json();
    expect(first.copy).toBeNull();
    expect(first.cached).toBe(false);
    const logged = warn.mock.calls.find((c) => c[0] === 'fit-verdict copy off contract; using templated copy');
    expect(logged?.[1]).toMatchObject({ rule: 'headline:too_long', length: 71, limit: 70 });

    // The same facts inside the day: the fallback, and no second call.
    const second = await (await GET(asMember('Lin', 'Lin'))).json();
    expect(second.copy).toBeNull();
    expect(second.cached).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // A day on, the same facts ask again.
    const docs = getStore()['insights'] as { rejected?: string; generatedAt: string }[];
    const doc = docs.find((d) => d.rejected === 'headline:too_long');
    expect(doc).toBeTruthy();
    doc!.generatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await GET(asMember('Lin', 'Lin'));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('a model failure still answers with the facts, and is not cached', async () => {
    const lin = seedMember('Lin');
    seedGear(lin.id);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCreate.mockRejectedValue(new Error('overloaded'));
    const res = await GET(asMember('Lin', 'Lin'));
    expect(res.status).toBe(200);
    expect((await res.json()).copy).toBeNull();
    await GET(asMember('Lin', 'Lin'));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('judges a frame the member does not own, with no current tension', async () => {
    const lin = seedMember('Lin');
    seedGear(lin.id);
    process.env.NEXT_PUBLIC_FLAG_FIT_VERDICT = 'false';
    const other = 'racket-yonex-astrox-88d-pro';
    const res = await GET(makeRequest('GET', `${BASE}?name=Lin&frame=${other}`, undefined, {
      Cookie: `member_session=${memberCookieValue('Lin')}`,
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.facts.currentTensionLbs).toBeNull();
    const missing = await GET(makeRequest('GET', `${BASE}?name=Lin&frame=racket-nope`, undefined, {
      Cookie: `member_session=${memberCookieValue('Lin')}`,
    }));
    expect(missing.status).toBe(404);
  });
});

describe('parseCopy', () => {
  const facts = { state: 'suits', reasons: [{ key: 'shaftFitsSwing', polarity: 'plus' }, { key: 'tensionInRange', polarity: 'plus' }] } as FitFacts;
  const GOOD = { headline: 'This racket is on your side', body: 'Nothing in your answers argues with it.', reasons: ['a', 'b'] };

  it('accepts a reply on the contract, fenced or not', () => {
    expect(parseCopy(JSON.stringify(GOOD), facts)).toEqual(GOOD);
    expect(parseCopy('```json\n' + JSON.stringify(GOOD) + '\n```', facts)).toEqual(GOOD);
  });

  it('allows the digits of the racket’s own name, and no others', () => {
    const named = { ...facts, frame: { name: 'Air Force 79', balance: 'Even', flex: 'Medium', weightClass: '4U' } } as FitFacts;
    expect(parseCopy(JSON.stringify({ ...GOOD, headline: 'Your Air Force 79 suits you' }), named)?.headline).toBe('Your Air Force 79 suits you');
    expect(parseCopy(JSON.stringify({ ...GOOD, headline: 'Your Air Force 79 wants 24 lb' }), named)).toBeNull();
  });

  it('refuses a number, a wrong reason count, an overlong line, or prose', () => {
    expect(parseCopy(JSON.stringify({ ...GOOD, body: 'String it at 24 lb.' }), facts)).toBeNull();
    expect(parseCopy(JSON.stringify({ ...GOOD, reasons: ['a'] }), facts)).toBeNull();
    expect(parseCopy(JSON.stringify({ ...GOOD, headline: 'x'.repeat(71) }), facts)).toBeNull();
    expect(parseCopy('Sure! Here is your verdict.', facts)).toBeNull();
  });

  it('names the first rule a reply broke, and never carries its text', () => {
    const named = { ...facts, frame: { name: 'Air Force 79', balance: 'Even', flex: 'Medium', weightClass: '4U' } } as FitFacts;
    const rule = (obj: unknown, f: FitFacts = facts) => checkCopy(typeof obj === 'string' ? obj : JSON.stringify(obj), f).rejection;
    expect(rule('Sure! Here is your verdict.')).toEqual({ rule: 'not_json' });
    expect(rule({ ...GOOD, headline: '' })).toEqual({ rule: 'headline:missing' });
    expect(rule({ ...GOOD, body: 'z'.repeat(221) })).toEqual({ rule: 'body:too_long', length: 221, limit: 220 });
    expect(rule({ ...GOOD, headline: 'Your Air Force 79 wants 24 lb' }, named)).toEqual({ rule: 'headline:digit' });
    expect(rule({ ...GOOD, reasons: ['a'] })).toEqual({ rule: 'reason_count' });
    expect(rule({ ...GOOD, reasons: ['a', 'String it at 24'] })).toEqual({ rule: 'reason_2:digit' });
    expect(checkCopy(JSON.stringify(GOOD), facts)).toEqual({ copy: GOOD });
  });
});
