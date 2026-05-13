import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedPlayer,
  seedTestAdminMember,
  makeAdminRequest,
  makeRequest,
} from './helpers';
import { PATCH } from '@/app/api/players/route';

setupAdminPin();

describe('PATCH /api/players writtenOff (v1.5/A)', () => {
  const sessionId = 'session-2026-05-13';

  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
    seedPointer(sessionId);
    seedSession(sessionId, { maxPlayers: 12 });
  });

  it('admin can set writtenOff: true on a player', async () => {
    const player = seedPlayer(sessionId, 'Bruce', { owedAmount: 8, paid: false });
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/players', {
      id: player.id,
      sessionId,
      writtenOff: true,
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.writtenOff).toBe(true);
    expect(body.deleteToken).toBeUndefined();
    expect(body.pinHash).toBeUndefined();
  });

  it('setting writtenOff: true also forces paid: false', async () => {
    const player = seedPlayer(sessionId, 'Bruce', { owedAmount: 8, paid: true });
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/players', {
      id: player.id,
      sessionId,
      writtenOff: true,
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.writtenOff).toBe(true);
    expect(body.paid).toBe(false);
  });

  it('setting paid: true also forces writtenOff: false', async () => {
    const player = seedPlayer(sessionId, 'Bruce', { owedAmount: 8, paid: false, writtenOff: true });
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/players', {
      id: player.id,
      sessionId,
      paid: true,
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paid).toBe(true);
    expect(body.writtenOff).toBe(false);
  });

  it('when body sets both paid:true and writtenOff:true, writtenOff wins', async () => {
    const player = seedPlayer(sessionId, 'Bruce', { owedAmount: 8, paid: false });
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/players', {
      id: player.id,
      sessionId,
      paid: true,
      writtenOff: true,
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.writtenOff).toBe(true);
    expect(body.paid).toBe(false);
  });

  it('non-admin self-call via deleteToken cannot set writtenOff', async () => {
    const player = seedPlayer(sessionId, 'Bruce', { owedAmount: 8, paid: false, deleteToken: 'self-token-bruce' });
    const req = makeRequest('PATCH', 'http://localhost:3000/api/players', {
      id: player.id,
      sessionId,
      writtenOff: true,
      deleteToken: 'self-token-bruce',
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });
});
