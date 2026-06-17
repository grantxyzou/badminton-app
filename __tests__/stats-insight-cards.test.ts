import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { resetMockStore, getStore, seedMember, seedPointer, makeGetRequest } from './helpers';

// Mock the Anthropic SDK so the route's single generate() call is deterministic.
// `vi.hoisted` makes the spy available inside the hoisted vi.mock factory.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { GET } from '../app/api/stats/insight/route';

const BASE = 'http://localhost:3000/api/stats/insight';

function textResponse(obj: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

function seedAssessment(memberId: string, takenAt: string, overall: number, lows: string[] = []) {
  const store = getStore();
  if (!store['assessments']) store['assessments'] = [];
  const ratings = [
    { skillKey: 'smashes', value: 4 },
    { skillKey: 'clears_lifts', value: 4 },
    { skillKey: 'drives', value: 3 },
    { skillKey: 'consistency', value: 3 },
    ...lows.map((skillKey) => ({ skillKey, value: 1 })),
  ];
  store['assessments'].push({ id: `a-${Math.random().toString(36).slice(2)}`, memberId, takenAt, ratings, overall, phase: null });
}

describe('/api/stats/insight — distributed insight cards', () => {
  beforeEach(() => {
    resetMockStore();
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS = 'true';
    process.env.NEXT_PUBLIC_FLAG_INSIGHT_CARDS = 'true';
    seedPointer('session-2026-06-17');
  });
  afterAll(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS;
    delete process.env.NEXT_PUBLIC_FLAG_INSIGHT_CARDS;
  });

  it('returns structured slices with server-set kinds when the flag is on', async () => {
    const m = seedMember('Lin');
    // overall 3.2 → phase-gating (level signal); net_play sticky → trend signal.
    seedAssessment(m.id, '2026-04-01', 3.1, ['net_play']);
    seedAssessment(m.id, '2026-05-01', 3.2, ['net_play']);
    mockCreate.mockResolvedValue(
      textResponse({
        greeting: 'Quietly leveling up — nice work.',
        level: { headline: 'A nudge from the next phase', support: 'Your weakest areas are the lever.' },
        trend: { headline: 'Net play keeps lagging', support: 'It has trailed for two check-ins.' },
      }),
    );

    const res = await GET(makeGetRequest(`${BASE}?name=Lin`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.account).toBe(true);
    expect(json.greeting).toBe('Quietly leveling up — nice work.');
    expect(json.level.headline).toBe('A nudge from the next phase');
    expect(json.level.kind).toBe('phase-gating'); // attached server-side, not from the model
    expect(json.trend.kind).toBe('sticky-weak');
    // Legacy shape absent on the cards path.
    expect(json.recap).toBeUndefined();
  });

  it('forces a card slice to null when no signal backs it (silence > obvious)', async () => {
    const m = seedMember('Akane');
    // Single flat mid-band check-in → no signals at all.
    seedAssessment(m.id, '2026-05-01', 2.7);
    // The model hallucinates a level insight anyway; the route must drop it.
    mockCreate.mockResolvedValue(
      textResponse({
        greeting: 'Good to see you back.',
        level: { headline: 'You are crushing it', support: 'made up' },
        trend: { headline: 'fabricated', support: 'nope' },
      }),
    );

    const res = await GET(makeGetRequest(`${BASE}?name=Akane`));
    const json = await res.json();
    expect(json.greeting).toBe('Good to see you back.');
    expect(json.level).toBeNull();
    expect(json.trend).toBeNull();
  });

  it('caches: a second call is served from cache without re-generating', async () => {
    const m = seedMember('Viktor');
    seedAssessment(m.id, '2026-05-01', 3.2, ['net_play']);
    mockCreate.mockResolvedValue(textResponse({ greeting: 'Hi Viktor.', level: null, trend: null }));

    const first = await GET(makeGetRequest(`${BASE}?name=Viktor`));
    expect((await first.json()).cached).toBe(false);
    const second = await GET(makeGetRequest(`${BASE}?name=Viktor`));
    const secondJson = await second.json();
    expect(secondJson.cached).toBe(true);
    expect(secondJson.greeting).toBe('Hi Viktor.');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('regenerates when the flag flips off (cached cards doc lacks recap)', async () => {
    const m = seedMember('Kento');
    seedAssessment(m.id, '2026-05-01', 3.2, ['net_play']);
    mockCreate.mockResolvedValue(textResponse({ greeting: 'Hi Kento.', level: null, trend: null }));
    await GET(makeGetRequest(`${BASE}?name=Kento`)); // caches a cards-shaped doc

    process.env.NEXT_PUBLIC_FLAG_INSIGHT_CARDS = 'false';
    mockCreate.mockResolvedValue(textResponse({ recap: 'Last week was solid.', focus: 'Work on net play.' }));
    const res = await GET(makeGetRequest(`${BASE}?name=Kento`));
    const json = await res.json();
    expect(json.recap).toBe('Last week was solid.');
    expect(json.focus).toBe('Work on net play.');
    expect(json.greeting).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('gates on account: an unknown name gets no insight and never calls the model', async () => {
    const res = await GET(makeGetRequest(`${BASE}?name=Stranger`));
    const json = await res.json();
    expect(json.account).toBe(false);
    expect(json.greeting).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
