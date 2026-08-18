import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as cosmos from '@/lib/cosmos';
import { resetMockStore, getStore, seedMember, seedPointer, makeGetRequest } from './helpers';

/**
 * The equipment card (EI Task 3): a fourth distributed-insight slice, wired
 * into the existing /api/stats/insight route alongside greeting/level/trend.
 * Mirrors the Anthropic-mock pattern established in stats-insight-cards.test.ts
 * (`vi.hoisted` + `vi.mock('@anthropic-ai/sdk')`) — reused rather than
 * reinvented, since it's the one already proven to make the route's single
 * generate() call deterministic.
 */
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

// Same 4-baseline-skills + explicit-lows shape as stats-insight-cards.test.ts —
// drives the level/trend signals (phase-gating / sticky-weak) via a real
// self-assessment history, unrelated to the equipment engine.
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

// The full real SKILLS key set (mirrors equipment-signals.test.ts's `snap()`)
// so `weakKey` is unambiguously the bottom-rated skill across ALL 14 keys —
// needed for the equipment engine's "persistent weakness" check, which reads
// bottomKeys() over the whole rated set, not just a 4-skill subset.
const ALL_SKILL_KEYS = [
  'serves_returns', 'net_play', 'clears_lifts', 'drops', 'drives', 'smashes',
  'grip_deception', 'footwork_split_step', 'court_coverage', 'speed_stamina',
  'game_reading', 'consistency', 'rules_strategy', 'training_mindset',
];
function seedWeakAssessment(memberId: string, takenAt: string, weakKey: string) {
  const store = getStore();
  if (!store['assessments']) store['assessments'] = [];
  store['assessments'].push({
    id: `a-${Math.random().toString(36).slice(2)}`,
    memberId,
    takenAt,
    overall: 3,
    phase: null,
    ratings: ALL_SKILL_KEYS.map((k) => ({ skillKey: k, value: k === weakKey ? 1 : 4 })),
  });
}

// Head-heavy / extra-stiff / 3U — the build SKILL_SPEC_CONFLICTS says fights
// drops/net_play. skillRange [1,6] deliberately spans every stage so the
// phase-mismatch/outgrowing signals can never fire and steal the pick from
// weakness-conflict.
async function seedCatalogRacket(id: string) {
  await cosmos.getContainer('equipmentCatalog').items.upsert({
    id,
    category: 'racket',
    brand: 'Test',
    model: id,
    skillRange: [1, 6],
    attributes: { balance: 'Head-heavy', flex: 'Extra Stiff', weight: '3U' },
  });
}

async function seedGear(memberId: string, catalogId: string) {
  await cosmos.getContainer('playerGear').items.upsert({
    id: `gear-${memberId}`,
    memberId,
    items: [{ id: 'g1', catalogId, category: 'racket', label: 'Test Racket' }],
    activeRacketId: 'g1',
  });
}

describe('/api/stats/insight — equipment card (NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT)', () => {
  beforeEach(() => {
    resetMockStore();
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS = 'true';
    process.env.NEXT_PUBLIC_FLAG_INSIGHT_CARDS = 'true';
    process.env.NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT = 'true';
    seedPointer('session-2026-06-17');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS;
    delete process.env.NEXT_PUBLIC_FLAG_INSIGHT_CARDS;
    delete process.env.NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT;
  });

  it('flag off: the response has no `equipment` key at all (not merely null), and no gear/catalog containers are ever touched', async () => {
    process.env.NEXT_PUBLIC_FLAG_EQUIPMENT_INSIGHT = 'false';
    const m = seedMember('Sindhu');
    seedAssessment(m.id, '2026-05-01', 3.2, ['net_play']);

    const realGetContainer = cosmos.getContainer;
    const calls: string[] = [];
    vi.spyOn(cosmos, 'getContainer').mockImplementation((name: string) => {
      calls.push(name);
      return realGetContainer(name);
    });

    mockCreate.mockResolvedValue(textResponse({ greeting: 'Hi Sindhu.', level: null, trend: null }));

    const res = await GET(makeGetRequest(`${BASE}?name=Sindhu`));
    expect(res.status).toBe(200);
    const json = await res.json();
    // The byte-for-byte constraint: flag off must not merely null the field,
    // the key itself must be absent — a client doing `'equipment' in payload`
    // or a strict-shape snapshot must see the pre-task response exactly.
    expect('equipment' in json).toBe(false);
    expect(calls).not.toContain('playerGear');
    expect(calls).not.toContain('equipmentCatalog');
  });

  it('flag on, member has no racket: equipment is null, level/trend still generate normally', async () => {
    const m = seedMember('Lin');
    seedAssessment(m.id, '2026-04-01', 3.1, ['net_play']);
    seedAssessment(m.id, '2026-05-01', 3.2, ['net_play']);
    // No playerGear doc seeded — activeRacket() resolves null, no diagnosis possible.
    mockCreate.mockResolvedValue(
      textResponse({
        greeting: 'Quietly leveling up.',
        level: { headline: 'A nudge from the next phase', support: 'Your weakest areas are the lever.' },
        trend: { headline: 'Net play keeps lagging', support: 'It has trailed for two check-ins.' },
        equipment: null,
      }),
    );

    const res = await GET(makeGetRequest(`${BASE}?name=Lin`));
    const json = await res.json();
    expect(json.level).toBeTruthy();
    expect(json.trend).toBeTruthy();
    expect(json.equipment).toBeNull();
  });

  it('flag on, racket + repeated weakness: equipment card present with server-set kind === weakness-conflict', async () => {
    const m = seedMember('Kento');
    await seedCatalogRacket('racket-conflict');
    await seedGear(m.id, 'racket-conflict');
    // 'drops' is bottom-rated across 3 consecutive check-ins — a real,
    // persistent pattern, not a one-off dip.
    seedWeakAssessment(m.id, '2026-04-01', 'drops');
    seedWeakAssessment(m.id, '2026-05-01', 'drops');
    seedWeakAssessment(m.id, '2026-06-01', 'drops');
    mockCreate.mockResolvedValue(
      textResponse({
        greeting: 'Good stretch.',
        level: null,
        trend: null,
        equipment: { headline: 'Your racket is fighting your drops', support: 'Extra-stiff, head-heavy builds make touch shots harder.' },
      }),
    );

    const res = await GET(makeGetRequest(`${BASE}?name=Kento`));
    const json = await res.json();
    expect(json.equipment).toBeTruthy();
    expect(json.equipment.kind).toBe('weakness-conflict');
    expect(json.equipment.headline).toBe('Your racket is fighting your drops');
  });

  it('the picked signal\'s `suggests` catalog id reaches the response payload (EI Task 4 seam)', async () => {
    // Regression: computeEquipmentSignals sets `suggests` on the signal, but
    // it was previously dropped when building the client-facing card — the
    // client had a catalog id to render but no way to receive it.
    const m = seedMember('Nozomi');
    await seedCatalogRacket('racket-conflict-2');
    // A second catalog racket that does NOT fight drops/net_play (head-light,
    // medium flex, 4U) — the only candidate suggestFrom() can pick, since the
    // owned racket is always excluded from its own pool.
    await cosmos.getContainer('equipmentCatalog').items.upsert({
      id: 'racket-friendly',
      category: 'racket',
      brand: 'Test',
      model: 'Friendly',
      skillRange: [1, 6],
      attributes: { balance: 'Head-light', flex: 'Medium', weight: '4U' },
    });
    await seedGear(m.id, 'racket-conflict-2');
    seedWeakAssessment(m.id, '2026-04-01', 'drops');
    seedWeakAssessment(m.id, '2026-05-01', 'drops');
    seedWeakAssessment(m.id, '2026-06-01', 'drops');
    mockCreate.mockResolvedValue(
      textResponse({
        greeting: 'Good stretch.',
        level: null,
        trend: null,
        equipment: { headline: 'Your racket is fighting your drops', support: 'x' },
      }),
    );

    const res = await GET(makeGetRequest(`${BASE}?name=Nozomi`));
    const json = await res.json();
    expect(json.equipment.suggests).toBe('racket-friendly');
  });

  it('a cached doc whose racketId differs from the current racket regenerates (not served stale)', async () => {
    const m = seedMember('Viktor');
    await seedCatalogRacket('racket-A');
    await seedGear(m.id, 'racket-A');
    mockCreate.mockResolvedValue(textResponse({ greeting: 'Hi Viktor.', level: null, trend: null, equipment: null }));

    const first = await GET(makeGetRequest(`${BASE}?name=Viktor`));
    expect((await first.json()).cached).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Player switches rackets mid-week.
    await seedCatalogRacket('racket-B');
    await seedGear(m.id, 'racket-B');

    const second = await GET(makeGetRequest(`${BASE}?name=Viktor`));
    const secondJson = await second.json();
    expect(secondJson.cached).toBe(false); // must NOT serve the racket-A-era cache
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('a cached doc whose racketId matches the current racket serves cache — no second Claude call', async () => {
    const m = seedMember('Carolina');
    await seedCatalogRacket('racket-same');
    await seedGear(m.id, 'racket-same');
    mockCreate.mockResolvedValue(textResponse({ greeting: 'Hi Carolina.', level: null, trend: null, equipment: null }));

    const first = await GET(makeGetRequest(`${BASE}?name=Carolina`));
    expect((await first.json()).cached).toBe(false);

    const second = await GET(makeGetRequest(`${BASE}?name=Carolina`));
    const secondJson = await second.json();
    expect(secondJson.cached).toBe(true);
    expect(secondJson.greeting).toBe('Hi Carolina.');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('a cached doc with ONLY an equipment slice (greeting/level/trend all null) still serves from cache — no repeat Claude call', async () => {
    // Regression coverage for the persist/serve asymmetry: the generation-bail
    // (`!cards.greeting && !cards.level && !cards.trend && !cards.equipment`)
    // correctly persists an equipment-only doc, but the cache SERVE guard must
    // recognize it too, or an equipment-only member re-calls Claude on every
    // request forever (cost bug — money, not just a stale read).
    const m = seedMember('Sania');
    await seedCatalogRacket('racket-eq-only');
    await seedGear(m.id, 'racket-eq-only');
    seedWeakAssessment(m.id, '2026-04-01', 'drops');
    seedWeakAssessment(m.id, '2026-05-01', 'drops');
    seedWeakAssessment(m.id, '2026-06-01', 'drops');
    mockCreate.mockResolvedValue(
      textResponse({
        greeting: null,
        level: null,
        trend: null,
        equipment: { headline: 'Your racket is fighting your drops', support: 'x' },
      }),
    );

    const first = await GET(makeGetRequest(`${BASE}?name=Sania`));
    const firstJson = await first.json();
    expect(firstJson.cached).toBe(false);
    expect(firstJson.greeting).toBeNull();
    expect(firstJson.level).toBeNull();
    expect(firstJson.trend).toBeNull();
    expect(firstJson.equipment).toBeTruthy();

    const second = await GET(makeGetRequest(`${BASE}?name=Sania`));
    const secondJson = await second.json();
    expect(secondJson.cached).toBe(true);
    expect(secondJson.equipment.headline).toBe('Your racket is fighting your drops');
    expect(mockCreate).toHaveBeenCalledTimes(1); // NOT called a second time
  });

  it('legacy branch (cards flag off, equipment flag on): a member with a racket does not re-call Claude on a second same-session request', async () => {
    // Regression for FIX 1: the shared cache-freshness check (`racketUnchanged`)
    // reads `existing.racketId` for BOTH the cards branch and the legacy
    // branch, but only the cards-branch upsert used to persist `racketId`.
    // On the legacy branch (cards off), `cachedRacketId` was always null and
    // never matched `currentRacketId` — so a member with a racket regenerated
    // (and re-called Claude) on EVERY request, forever. Not reachable in
    // either deployed workflow (both set INSIGHT_CARDS=true) but fully
    // reachable locally, which is exactly where EQUIPMENT_INSIGHT gets
    // flipped on first.
    process.env.NEXT_PUBLIC_FLAG_INSIGHT_CARDS = 'false';
    const m = seedMember('Ratchanok');
    await seedCatalogRacket('racket-legacy');
    await seedGear(m.id, 'racket-legacy');
    mockCreate.mockResolvedValue(textResponse({ recap: 'Solid week.', focus: 'Keep working on drops.' }));

    const first = await GET(makeGetRequest(`${BASE}?name=Ratchanok`));
    const firstJson = await first.json();
    expect(firstJson.cached).toBe(false);
    expect(firstJson.recap).toBe('Solid week.');

    const second = await GET(makeGetRequest(`${BASE}?name=Ratchanok`));
    const secondJson = await second.json();
    expect(secondJson.cached).toBe(true);
    expect(secondJson.recap).toBe('Solid week.');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('a gear-read failure is non-fatal: level/trend still generate, equipment comes back null', async () => {
    const m = seedMember('Akane');
    seedAssessment(m.id, '2026-04-01', 3.1, ['net_play']);
    seedAssessment(m.id, '2026-05-01', 3.2, ['net_play']);

    const realGetContainer = cosmos.getContainer;
    vi.spyOn(cosmos, 'getContainer').mockImplementation((name: string) => {
      if (name === 'playerGear') throw new Error('gear read failed');
      return realGetContainer(name);
    });

    mockCreate.mockResolvedValue(
      textResponse({
        greeting: 'Hi Akane.',
        level: { headline: 'A nudge from the next phase', support: 'x' },
        trend: { headline: 'Net play keeps lagging', support: 'y' },
        // The model hallucinates equipment advice anyway — no signal backs
        // it (playerRacket never resolved), so the route must drop it.
        equipment: { headline: 'fabricated', support: 'nope' },
      }),
    );

    const res = await GET(makeGetRequest(`${BASE}?name=Akane`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.level).toBeTruthy();
    expect(json.trend).toBeTruthy();
    expect(json.equipment).toBeNull();
  });
});
