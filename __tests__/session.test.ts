import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedPlayer,
  makeRequest,
  makeAdminRequest,
  makeGetRequest,
  getStore,
} from './helpers';
import { GET, PUT } from '@/app/api/session/route';
import { POST as ADVANCE } from '@/app/api/session/advance/route';
import { GET as GET_COSTS } from '@/app/api/sessions/costs/route';
import { POST as CREATE_BIRD } from '@/app/api/birds/route';

setupAdminPin();

describe('GET /api/session', () => {
  beforeEach(() => {
    resetMockStore();
    seedPointer('session-2026-04-05');
    seedSession('session-2026-04-05', { title: 'Test Session' });
  });

  it('returns the active session with expected shape', async () => {
    // ARRANGE
    const req = makeGetRequest('http://localhost:3000/api/session');

    // ACT
    const res = await GET(req as never);
    const data = await res.json();

    // ASSERT: key fields present
    expect(res.status).toBe(200);
    expect(data.title).toBe('Test Session');
    expect(data.maxPlayers).toBeDefined();
    expect(data.id).toBe('session-2026-04-05');
  });
});

describe('PUT /api/session', () => {
  beforeEach(() => {
    resetMockStore();
    seedPointer('session-2026-04-05');
    seedSession('session-2026-04-05', { title: 'Original Title' });
  });

  it('admin can update the session title → 200 with new title', async () => {
    // ARRANGE
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Updated Title',
      courts: 3,
      maxPlayers: 18,
    });

    // ACT
    const res = await PUT(req);
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(200);
    expect(data.title).toBe('Updated Title');
  });

  it('non-admin → 401', async () => {
    // ARRANGE: unauthenticated PUT request
    const req = makeRequest('PUT', 'http://localhost:3000/api/session', { title: 'Hacked' });

    // ACT
    const res = await PUT(req);

    // ASSERT
    expect(res.status).toBe(401);
  });

  it('saves a single bird usage in the birdUsages array', async () => {
    const birdRes = await CREATE_BIRD(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
      name: 'Victor Master No.3', tubes: 4, totalCost: 80,
    }));
    const bird = await birdRes.json();

    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsages: [{ purchaseId: bird.id, tubes: 2 }],
    });
    const res = await PUT(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.birdUsages).toHaveLength(1);
    expect(data.birdUsages[0].tubes).toBe(2);
    expect(data.birdUsages[0].costPerTube).toBe(20);
    expect(data.birdUsages[0].totalBirdCost).toBe(40);
    expect(data.birdUsages[0].purchaseId).toBe(bird.id);
    expect(data.birdUsages[0].purchaseName).toBe('Victor Master No.3');
  });

  it('saves multiple bird sources with 0.5-tube increments', async () => {
    const a = await (await CREATE_BIRD(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
      name: 'Victor A', tubes: 4, totalCost: 80,
    }))).json();
    const b = await (await CREATE_BIRD(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
      name: 'Yonex B', tubes: 4, totalCost: 100,
    }))).json();

    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsages: [
        { purchaseId: a.id, tubes: 1.5 },
        { purchaseId: b.id, tubes: 0.5 },
      ],
    });
    const res = await PUT(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.birdUsages).toHaveLength(2);
    expect(data.birdUsages[0].tubes).toBe(1.5);
    expect(data.birdUsages[0].costPerTube).toBe(20);
    expect(data.birdUsages[0].totalBirdCost).toBe(30); // 1.5 * 20
    expect(data.birdUsages[0].purchaseName).toBe('Victor A');
    expect(data.birdUsages[1].tubes).toBe(0.5);
    expect(data.birdUsages[1].costPerTube).toBe(25);
    expect(data.birdUsages[1].totalBirdCost).toBe(12.5); // 0.5 * 25
    expect(data.birdUsages[1].purchaseName).toBe('Yonex B');
  });

  it('migrates legacy birdUsage shape when saving', async () => {
    // Seed a doc with the old single-object shape directly in the mock store
    const store = getStore();
    const sessionDoc = (store.sessions as Record<string, unknown>[]).find(
      (s) => (s as { id: string }).id === 'session-2026-04-05',
    ) as Record<string, unknown>;
    sessionDoc.birdUsage = {
      tubes: 3,
      costPerTube: 20,
      totalBirdCost: 60,
      purchaseId: 'legacy-id',
      purchaseName: 'Legacy Bird',
    };

    const birdRes = await CREATE_BIRD(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
      name: 'New Purchase', tubes: 4, totalCost: 80,
    }));
    const bird = await birdRes.json();

    const res = await PUT(makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsages: [{ purchaseId: bird.id, tubes: 2 }],
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.birdUsages).toHaveLength(1);
    expect(data.birdUsages[0].purchaseName).toBe('New Purchase');
    // Legacy field must be gone from the persisted doc
    expect(data.birdUsage).toBeUndefined();
  });

  it('rejects bird tubes not in 0.5 increments', async () => {
    const bird = await (await CREATE_BIRD(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
      name: 'Test', tubes: 4, totalCost: 80,
    }))).json();

    const res = await PUT(makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsages: [{ purchaseId: bird.id, tubes: 0.33 }],
    }));
    expect(res.status).toBe(400);
  });

  it('rejects negative bird tubes', async () => {
    const bird = await (await CREATE_BIRD(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
      name: 'Test', tubes: 4, totalCost: 80,
    }))).json();

    const res = await PUT(makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsages: [{ purchaseId: bird.id, tubes: -1 }],
    }));
    expect(res.status).toBe(400);
  });

  it('rejects bird usage with missing purchaseId', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsages: [{ tubes: 2 }],
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('rejects bird usage with unknown purchaseId', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsages: [{ purchaseId: 'nonexistent', tubes: 2 }],
    });
    const res = await PUT(req);
    expect(res.status).toBe(404);
  });

  it('clears bird usages with an empty array', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsages: [],
    });
    const res = await PUT(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data.birdUsages)).toBe(true);
    expect(data.birdUsages).toHaveLength(0);
  });
});

describe('POST /api/session/advance', () => {
  beforeEach(() => {
    resetMockStore();
    seedPointer('session-2026-04-05');
    seedSession('session-2026-04-05', { title: 'Test Session' });
  });

  it('admin can advance to a new date → 201, new session created', async () => {
    // ARRANGE: advance to the following Sunday
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-04-12T19:00:00-07:00',
    });

    // ACT
    const res = await ADVANCE(req);
    const data = await res.json();

    // ASSERT: created with correct session ID derived from the date
    expect(res.status).toBe(201);
    expect(data.id).toBe('session-2026-04-12');
    expect(data.datetime).toBe('2026-04-12T19:00:00-07:00');
    // New sessions always start with signups closed
    expect(data.signupOpen).toBe(false);
  });

  it('missing datetime → 400', async () => {
    // ARRANGE: body with no datetime
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {});

    // ACT
    const res = await ADVANCE(req);
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(400);
    expect(data.error).toBe('datetime required');
  });

  it('non-admin → 401', async () => {
    // ARRANGE: unauthenticated request
    const req = makeRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-04-12T19:00:00-07:00',
    });

    // ACT
    const res = await ADVANCE(req);

    // ASSERT
    expect(res.status).toBe(401);
  });

  it('carries forward costPerCourt when provided', async () => {
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-04-12T19:00:00-07:00',
      costPerCourt: 20,
    });

    const res = await ADVANCE(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.costPerCourt).toBe(20);
  });

  it('clamps costPerCourt to 0-500 range', async () => {
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-04-19T19:00:00-07:00',
      costPerCourt: 999,
    });

    const res = await ADVANCE(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.costPerCourt).toBe(500);
  });

  it('snapshots prevCostPerPerson from the current session', async () => {
    // ARRANGE: current session has costPerCourt=20, courts=2, and 4 active players
    const store = getStore();
    // Index 0 is the pointer, index 1 is the actual session
    store['sessions']![1] = {
      ...store['sessions']![1] as Record<string, unknown>,
      costPerCourt: 20,
      courts: 2,
      datetime: '2026-04-05T19:00:00-07:00',
    };
    // Seed 4 active players for the current session
    seedPlayer('session-2026-04-05', 'Alice');
    seedPlayer('session-2026-04-05', 'Bob');
    seedPlayer('session-2026-04-05', 'Charlie');
    seedPlayer('session-2026-04-05', 'Diana');

    // ACT
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-04-12T19:00:00-07:00',
    });
    const res = await ADVANCE(req);
    const data = await res.json();

    // ASSERT: (20 * 2) / 4 = $10.00 per person
    expect(res.status).toBe(201);
    expect(data.prevCostPerPerson).toBe(10);
    expect(data.prevSessionDate).toBe('2026-04-05T19:00:00-07:00');
  });

  it('omits prevCostPerPerson when current session has no cost', async () => {
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-04-12T19:00:00-07:00',
    });
    const res = await ADVANCE(req);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.prevCostPerPerson).toBeUndefined();
    expect(data.prevSessionDate).toBeUndefined();
  });
});

describe('GET /api/sessions/costs', () => {
  beforeEach(() => {
    resetMockStore();
    seedPointer('session-2026-04-05');
  });

  it('returns deduplicated costs from recent sessions', async () => {
    seedSession('session-2026-03-01', { costPerCourt: 20 });
    seedSession('session-2026-03-08', { costPerCourt: 18 });
    seedSession('session-2026-03-15', { costPerCourt: 20 });
    seedSession('session-2026-04-05', { costPerCourt: 22 });

    const req = makeGetRequest('http://localhost:3000/api/sessions/costs', true);
    const res = await GET_COSTS(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.costs).toEqual([18, 20, 22]);
  });

  it('excludes sessions with no costPerCourt', async () => {
    seedSession('session-2026-03-01', { costPerCourt: 15 });
    seedSession('session-2026-03-08', {});

    const req = makeGetRequest('http://localhost:3000/api/sessions/costs', true);
    const res = await GET_COSTS(req);
    const data = await res.json();

    expect(data.costs).toEqual([15]);
  });

  it('non-admin → 401', async () => {
    const req = makeGetRequest('http://localhost:3000/api/sessions/costs');
    const res = await GET_COSTS(req);
    expect(res.status).toBe(401);
  });
});
