import { describe, it, expect, beforeEach } from 'vitest';
import { PATCH } from '@/app/api/players/route';
import {
  resetMockStore,
  setupAdminPin,
  seedAdminMember,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  makeAdminRequest,
  makeRequest,
  memberCookieValue,
  getStore,
} from './helpers';

/**
 * Grant, 2026-11-12: "Give organizer and admin the ability to promote
 * waitlisted people even if the session is full." `overCapacity: true` on an
 * admin's promotion moves someone in over the cap; without it a full session
 * still answers 409, and nothing else about capacity changes.
 */

const SESSION = 'session-2026-11-19';
const URL = 'http://localhost/api/players';
const row = (id: string) =>
  ((getStore()['players'] ?? []) as Array<Record<string, unknown>>).find((p) => p.id === id);

describe('promoting from the waitlist into a full session', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    seedAdminMember();
    seedPointer(SESSION);
    seedSession(SESSION, { maxPlayers: 2 });
    seedPlayer(SESSION, 'Lin', { id: 'lin', timestamp: '2026-11-12T10:00:00.000Z' });
    seedPlayer(SESSION, 'Viktor', { id: 'viktor', timestamp: '2026-11-12T10:01:00.000Z' });
    seedPlayer(SESSION, 'Kento', { id: 'kento', waitlisted: true, timestamp: '2026-11-12T10:02:00.000Z' });
    seedPlayer(SESSION, 'Akane', { id: 'akane', waitlisted: true, timestamp: '2026-11-12T10:03:00.000Z' });
  });

  it('is still refused without the override', async () => {
    const res = await PATCH(makeAdminRequest('PATCH', URL, { id: 'kento', waitlisted: false }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Session is full');
    expect(row('kento')).toMatchObject({ waitlisted: true });
  });

  it('moves them in over the cap when the organiser asks for it', async () => {
    const res = await PATCH(makeAdminRequest('PATCH', URL, { id: 'kento', waitlisted: false, overCapacity: true }));
    expect(res.status).toBe(200);
    expect(row('kento')).toMatchObject({ waitlisted: false });
    expect(typeof row('kento')?.promotedAt).toBe('string');
    const playing = ((getStore()['players'] ?? []) as Array<Record<string, unknown>>).filter((p) => p.waitlisted !== true && p.removed !== true);
    expect(playing).toHaveLength(3);
  });

  it('is an admin power only: a member cannot send it', async () => {
    seedMember('Taufik', { id: 'm-taufik' });
    const res = await PATCH(
      makeRequest('PATCH', URL, { id: 'kento', waitlisted: false, overCapacity: true }, {
        Cookie: `member_session=${memberCookieValue('Taufik')}`,
      }),
    );
    expect(res.status).toBe(401);
    expect(row('kento')).toMatchObject({ waitlisted: true });
  });

  it('does not stretch to restoring a removed player into a full session', async () => {
    seedPlayer(SESSION, 'Sindhu', { id: 'sindhu', removed: true, timestamp: '2026-11-12T09:00:00.000Z' });
    const res = await PATCH(makeAdminRequest('PATCH', URL, { id: 'sindhu', removed: false, overCapacity: true }));
    expect(res.status).toBe(409);
    expect(row('sindhu')).toMatchObject({ removed: true });
  });

  it('while over the cap, a spot that opens up is not handed on: the count is still at the cap', async () => {
    await PATCH(makeAdminRequest('PATCH', URL, { id: 'kento', waitlisted: false, overCapacity: true }));
    const res = await PATCH(makeAdminRequest('PATCH', URL, { id: 'viktor', removed: true }));
    expect(res.status).toBe(200);
    // 3 → 2 playing on a cap of 2: no free spot, so Akane keeps waiting.
    expect(row('akane')).toMatchObject({ waitlisted: true });
  });
});
