import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  makeRequest,
  makeAdminRequest,
  makeGetRequest,
} from './helpers';
import { GET, PUT } from '@/app/api/session/route';
import { POST as ADVANCE } from '@/app/api/session/advance/route';
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

  it('saves bird usage with specific purchase price', async () => {
    const birdRes = await CREATE_BIRD(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
      name: 'Victor Master No.3', tubes: 4, totalCost: 80,
    }));
    const bird = await birdRes.json();

    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsage: { tubes: 2, purchaseId: bird.id },
    });
    const res = await PUT(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.birdUsage.tubes).toBe(2);
    expect(data.birdUsage.costPerTube).toBe(20);
    expect(data.birdUsage.totalBirdCost).toBe(40);
    expect(data.birdUsage.purchaseId).toBe(bird.id);
    expect(data.birdUsage.purchaseName).toBe('Victor Master No.3');
  });

  it('rejects bird usage with missing purchaseId', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsage: { tubes: 2 },
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('rejects bird usage with unknown purchaseId', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      title: 'Test',
      courts: 2,
      maxPlayers: 12,
      birdUsage: { tubes: 2, purchaseId: 'nonexistent' },
    });
    const res = await PUT(req);
    expect(res.status).toBe(404);
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
});
