import { describe, it, expect, beforeEach } from 'vitest';
import { POST as aliasesPOST, PATCH as aliasesPATCH, DELETE as aliasesDELETE } from '@/app/api/aliases/route';
import { POST as announcementsPOST } from '@/app/api/announcements/route';
import { POST as birdsPOST } from '@/app/api/birds/route';
import { POST as releasesPOST } from '@/app/api/releases/route';
import { POST as skillsPOST } from '@/app/api/skills/route';
import { PUT as sessionPUT } from '@/app/api/session/route';
import { POST as advancePOST } from '@/app/api/session/advance/route';
import { POST as settlePOST } from '@/app/api/session/settle/route';
import { PATCH as birdUsagePATCH } from '@/app/api/session/bird-usage/route';
import { POST as dismissPOST } from '@/app/api/session/dismiss-anomaly/route';
import { DELETE as playersDELETE } from '@/app/api/players/route';
import { POST as resetAccessPOST } from '@/app/api/players/reset-access/route';
import { POST as backfillPOST } from '@/app/api/admin/backfill-attendance/route';
import { POST as migratePOST } from '@/app/api/admin/migrate-memberId/route';
import { POST as membersPOST, PATCH as membersPATCH, DELETE as membersDELETE } from '@/app/api/members/route';
import {
  resetMockStore,
  setupAdminPin,
  makeAdminRequest,
  seedAdminMember,
  seedPointer,
  seedSession,
  seedPlayer,
  getStore,
} from './helpers';

import type { NextRequest } from 'next/server';

type Handler = (req: NextRequest) => Promise<Response>;

/**
 * Every audit-scoped *mutating* admin route must re-check the caller's role on
 * each request (via `isAdminAuthedWithMember`), so an admin demoted or
 * deactivated AFTER login loses write powers immediately rather than at the
 * 30-day cookie expiry. With a valid admin cookie but a member doc whose
 * `role !== 'admin'` (or `active === false`), the route must return 401.
 */
const MUTATING_ROUTES: Array<{ name: string; handler: Handler; method: string; url: string; body?: Record<string, unknown> }> = [
  { name: 'aliases POST', handler: aliasesPOST, method: 'POST', url: 'http://localhost:3000/api/aliases', body: { name: 'x', etransferName: 'y' } },
  { name: 'aliases PATCH', handler: aliasesPATCH, method: 'PATCH', url: 'http://localhost:3000/api/aliases', body: { name: 'x', etransferName: 'y' } },
  { name: 'aliases DELETE', handler: aliasesDELETE, method: 'DELETE', url: 'http://localhost:3000/api/aliases?name=x' },
  { name: 'announcements POST', handler: announcementsPOST, method: 'POST', url: 'http://localhost:3000/api/announcements', body: { text: 'hi' } },
  { name: 'birds POST', handler: birdsPOST, method: 'POST', url: 'http://localhost:3000/api/birds', body: { brand: 'Yonex', model: 'AS-30', tubesBought: 1, pricePerTube: 30 } },
  { name: 'releases POST', handler: releasesPOST, method: 'POST', url: 'http://localhost:3000/api/releases', body: { version: 'v9', notes: 'x' } },
  { name: 'skills POST', handler: skillsPOST, method: 'POST', url: 'http://localhost:3000/api/skills', body: { name: 'x', skills: {} } },
  { name: 'session PUT', handler: sessionPUT, method: 'PUT', url: 'http://localhost:3000/api/session', body: { title: 'x' } },
  { name: 'session/advance POST', handler: advancePOST, method: 'POST', url: 'http://localhost:3000/api/session/advance', body: {} },
  { name: 'session/settle POST', handler: settlePOST, method: 'POST', url: 'http://localhost:3000/api/session/settle', body: {} },
  { name: 'session/bird-usage PATCH', handler: birdUsagePATCH, method: 'PATCH', url: 'http://localhost:3000/api/session/bird-usage', body: { purchaseId: 'x', sessionId: 'session-2026-04-24', tubes: 1 } },
  { name: 'session/dismiss-anomaly POST', handler: dismissPOST, method: 'POST', url: 'http://localhost:3000/api/session/dismiss-anomaly', body: { key: 'x' } },
  { name: 'players/reset-access POST', handler: resetAccessPOST, method: 'POST', url: 'http://localhost:3000/api/players/reset-access', body: { name: 'x' } },
  { name: 'admin/backfill-attendance POST', handler: backfillPOST, method: 'POST', url: 'http://localhost:3000/api/admin/backfill-attendance', body: {} },
  { name: 'admin/migrate-memberId POST', handler: migratePOST, method: 'POST', url: 'http://localhost:3000/api/admin/migrate-memberId', body: {} },
  { name: 'members POST', handler: membersPOST, method: 'POST', url: 'http://localhost:3000/api/members', body: { name: 'x' } },
  { name: 'members PATCH', handler: membersPATCH, method: 'PATCH', url: 'http://localhost:3000/api/members', body: { id: 'x' } },
  { name: 'members DELETE', handler: membersDELETE, method: 'DELETE', url: 'http://localhost:3000/api/members?id=x' },
];

describe('admin role re-check on mutating routes (demotion takes effect immediately)', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
  });

  for (const route of MUTATING_ROUTES) {
    it(`${route.name} returns 401 when the cookie's member was demoted to non-admin`, async () => {
      seedAdminMember({ role: 'member' });
      const res = await route.handler(makeAdminRequest(route.method, route.url, route.body));
      expect(res.status).toBe(401);
    });
  }

  it('aliases POST returns 401 when the cookie\'s member was deactivated', async () => {
    seedAdminMember({ active: false });
    const res = await aliasesPOST(
      makeAdminRequest('POST', 'http://localhost:3000/api/aliases', { name: 'x', etransferName: 'y' }),
    );
    expect(res.status).toBe(401);
  });
});

/**
 * players DELETE doesn't hard-401 on a non-admin — it degrades the inline
 * `isAdmin` flag and falls through to the player-self cancel path. So the
 * demotion contract here is behavioural: a demoted admin's `purgeAll` must NOT
 * hard-delete the session's roster.
 */
describe('players DELETE purgeAll is refused for a demoted admin', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedPointer('session-2026-04-24');
    seedSession('session-2026-04-24');
  });

  it('leaves the roster intact when the cookie\'s member is no longer admin', async () => {
    seedPlayer('session-2026-04-24', 'Alice');
    seedPlayer('session-2026-04-24', 'Bob');
    seedAdminMember({ role: 'member' });

    await playersDELETE(
      makeAdminRequest('DELETE', 'http://localhost:3000/api/players', { purgeAll: true }),
    );

    const players = (getStore()['players'] ?? []) as Array<{ name: string }>;
    expect(players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
  });
});
