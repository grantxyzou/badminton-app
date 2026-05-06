import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedTestAdminMember,
  makeAdminRequest,
  makeRequest,
} from './helpers';
import { PUT } from '@/app/api/session/route';

setupAdminPin();

describe('PUT /api/session — eTransferRecipient + anomaliesDismissed', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
    seedPointer('session-2026-05-06');
    seedSession('session-2026-05-06', {
      courts: 2,
      costPerCourt: 32,
      maxPlayers: 12,
    });
  });

  it('admin can set eTransferRecipient with valid shape', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      eTransferRecipient: {
        name: 'Grant Zou',
        email: 'xyzou2012@gmail.com',
        memo: 'BPM {date} - {name}',
      },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eTransferRecipient.email).toBe('xyzou2012@gmail.com');
    expect(body.eTransferRecipient.name).toBe('Grant Zou');
  });

  it('rejects eTransferRecipient with missing email', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      eTransferRecipient: { name: 'Grant Zou' }, // no email
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('rejects eTransferRecipient with non-object value', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      eTransferRecipient: 'just-a-string',
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('admin can set anomaliesDismissed', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      anomaliesDismissed: ['settings_drift', 'long_break'],
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anomaliesDismissed).toEqual(['settings_drift', 'long_break']);
  });

  it('rejects anomaliesDismissed with non-string entries', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      anomaliesDismissed: ['settings_drift', 42],
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('non-admin cannot PUT', async () => {
    const req = makeRequest('PUT', 'http://localhost:3000/api/session', {
      eTransferRecipient: { name: 'X', email: 'x@x.com' },
    });
    const res = await PUT(req);
    expect(res.status).toBe(401);
  });
});
