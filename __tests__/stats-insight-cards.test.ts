import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { resetMockStore, getStore, seedMember, seedPointer, setupAdminPin, makeRequest, memberCookieValue } from './helpers';

// Mock the Anthropic SDK so the route's single generate() call is deterministic.
// `vi.hoisted` makes the spy available inside the hoisted vi.mock factory.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { NextRequest } from 'next/server';
import { GET } from '../app/api/stats/insight/route';

const BASE = 'http://localhost:3000/api/stats/insight';

// The route is owner-or-admin gated (`ownsNameOrAdmin`), so every case carries a
// `member_session` cookie for the name it asks about. `setupAdminPin()` in
// beforeEach installs the SESSION_SECRET the cookie is signed with.
function getAs(name: string) {
  return makeRequest('GET', `${BASE}?name=${encodeURIComponent(name)}`, undefined, {
    Cookie: `member_session=${memberCookieValue(name)}`,
  });
}

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
    setupAdminPin();
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    seedPointer('session-2026-06-17');
  });
  afterAll(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns structured slices with server-set kinds', async () => {
    const m = seedMember('Lin');
    // net_play sticky across two check-ins → trend signal.
    seedAssessment(m.id, '2026-04-01', 3.1, ['net_play']);
    seedAssessment(m.id, '2026-05-01', 3.2, ['net_play']);
    mockCreate.mockResolvedValue(
      textResponse({
        greeting: 'Quietly leveling up — nice work.',
        trend: { headline: 'Net play keeps lagging', support: 'It has trailed for two check-ins.' },
      }),
    );

    const res = await GET(getAs('Lin'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.account).toBe(true);
    expect(json.greeting).toBe('Quietly leveling up — nice work.');
    expect(json.trend.headline).toBe('Net play keeps lagging');
    expect(json.trend.kind).toBe('sticky-weak'); // attached server-side, not from the model
    // Legacy shape absent on the cards path.
    expect(json.recap).toBeUndefined();
    // The level slice is gone entirely — not null, absent. It was generated and
    // rendered nowhere, so it stopped being asked for (2026-08-27).
    expect('level' in json).toBe(false);
  });

  it('forces a card slice to null when no signal backs it (silence > obvious)', async () => {
    const m = seedMember('Akane');
    // Single flat mid-band check-in → no signals at all.
    seedAssessment(m.id, '2026-05-01', 2.7);
    // The model hallucinates slices anyway; the route must drop them. Includes a
    // `level` the route no longer even asks for — a stale or creative response
    // must not reintroduce a field nothing renders.
    mockCreate.mockResolvedValue(
      textResponse({
        greeting: 'Good to see you back.',
        level: { headline: 'You are crushing it', support: 'made up' },
        trend: { headline: 'fabricated', support: 'nope' },
      }),
    );

    const res = await GET(getAs('Akane'));
    const json = await res.json();
    expect(json.greeting).toBe('Good to see you back.');
    expect(json.trend).toBeNull();
    expect('level' in json).toBe(false);
  });

  it('caches: a second call is served from cache without re-generating', async () => {
    const m = seedMember('Viktor');
    seedAssessment(m.id, '2026-05-01', 3.2, ['net_play']);
    mockCreate.mockResolvedValue(textResponse({ greeting: 'Hi Viktor.', level: null, trend: null }));

    const first = await GET(getAs('Viktor'));
    expect((await first.json()).cached).toBe(false);
    const second = await GET(getAs('Viktor'));
    const secondJson = await second.json();
    expect(secondJson.cached).toBe(true);
    expect(secondJson.greeting).toBe('Hi Viktor.');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('gates on account: an unknown name gets no insight and never calls the model', async () => {
    const res = await GET(getAs('Stranger'));
    const json = await res.json();
    expect(json.account).toBe(false);
    expect(json.greeting).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

/**
 * The throttle used to answer `emptyPayload(true)` — HTTP 200 with every field
 * null — which is exactly what "this member has no insight yet" looks like. A
 * rate-limited read was therefore indistinguishable from a legitimate absence
 * and the greeting simply vanished, with nothing to explain it or to retry.
 *
 * Reachable in ordinary use, not just under attack: the limit is 30/hr per IP,
 * a whole club shares one NAT address at the venue, and a page load that hits
 * the 403 path issues FOUR of these (refusals are deliberately not memoized).
 */
describe('GET /api/stats/insight — a throttled read is not an empty one', () => {
  it('returns a real 429, not 200 with a null payload', async () => {
    const ip = `insight-throttle-${Math.random()}`;
    const req = () =>
      new NextRequest(new URL(`${BASE}?name=Lin`), {
        headers: { 'x-client-ip': ip, cookie: `member_session=${memberCookieValue('Lin')}` },
      });

    // Limit is 30/hr on one IP; burn past it.
    let res = await GET(req());
    for (let i = 0; i < 32; i++) res = await GET(req());

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe('rate_limited');
    // The tell: no `account` field, so no consumer can mistake it for a payload.
    expect(body.account).toBeUndefined();
  });
});
