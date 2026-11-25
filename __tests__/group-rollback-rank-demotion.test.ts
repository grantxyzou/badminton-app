/**
 * A BPM Core rank lowered to member takes the rollback copy with it
 * (2026-11-25, lib/rollbackRank.ts `followRankDown`).
 *
 * With groups on, a rank lives on the club's membership; `Member.role` is the
 * flag-off copy that a rollback reads again. Removals already drop it (PR
 * #1051). These pin the three ways a rank is LOWERED without a removal: the
 * organiser's rank change, stepping down, and the operator's override. Each
 * wrote only the membership, so a demoted BPM admin would have been an admin
 * again after a rollback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  resetMockStore, seedMember, seedGroup, seedMembership, setupAdminPin, seedTestAdminMember,
  adminCookieValue, getStore, ADMIN_MEMBER_ID,
} from './helpers';
import { PATCH as changeRank } from '../app/api/groups/members/[memberId]/route';
import { POST as stepDownRoute } from '../app/api/groups/step-down/route';
import { POST as override } from '../app/api/operator/membership/route';

const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const KEY = 'test-migration-key-of-sufficient-length';
const saved = { flag: process.env[FLAG], key: process.env.MIGRATION_KEY, ops: process.env.OPERATOR_MEMBER_IDS };

beforeEach(async () => {
  process.env[FLAG] = 'true';
  process.env.MIGRATION_KEY = KEY;
  process.env.OPERATOR_MEMBER_IDS = ADMIN_MEMBER_ID;
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember(); // BPM Core's organiser, and the operator
  seedGroup('bpm', { name: 'BPM Core' });
  seedGroup('x', { name: 'Other Club', ownerMemberId: ADMIN_MEMBER_ID });
  seedMembership('x', ADMIN_MEMBER_ID, { name: 'Grant', role: 'owner' });
});
afterEach(() => {
  for (const [k, v] of [[FLAG, saved.flag], ['MIGRATION_KEY', saved.key], ['OPERATOR_MEMBER_IDS', saved.ops]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const roleOf = (id: string) => ((getStore()['members'] ?? []) as Array<{ id: string; role?: string }>).find((m) => m.id === id)?.role;
const cookieIn = (groupId: string) => ({ cookie: `admin_session=${adminCookieValue({ groupId })}`, 'x-client-ip': `r-${Math.random()}` });

function linAdminIn(groupId: string) {
  const lin = seedMember('Lin', { id: 'm-lin', role: 'admin' });
  seedMembership(groupId, lin.id, { name: 'Lin', role: 'admin' });
  return lin;
}
const rank = (groupId: string, memberId: string, role: string) =>
  changeRank(
    new NextRequest(`http://localhost/api/groups/members/${memberId}`, { method: 'PATCH', headers: cookieIn(groupId), body: JSON.stringify({ role }) }),
    { params: Promise.resolve({ memberId }) },
  );

describe('the organiser lowers a rank', () => {
  it('in BPM Core: the rollback copy drops to member', async () => {
    const lin = linAdminIn('bpm');
    expect((await rank('bpm', lin.id, 'member')).status).toBe(200);
    expect(roleOf(lin.id)).toBe('member');
  });

  it('in another club: the Member is never touched (flag-off is BPM)', async () => {
    const lin = linAdminIn('x');
    expect((await rank('x', lin.id, 'member')).status).toBe(200);
    expect(roleOf(lin.id)).toBe('admin');
  });

  it('a rank RAISED writes nothing to the copy (a rollback then reads a member: the safe way round)', async () => {
    const kento = seedMember('Kento', { id: 'm-kento' });
    seedMembership('bpm', kento.id, { name: 'Kento' });
    expect((await rank('bpm', kento.id, 'admin')).status).toBe(200);
    expect(roleOf(kento.id)).toBe('member');
  });
});

describe('BPM Core’s organiser steps down', () => {
  const stepDown = (to: string) =>
    stepDownRoute(new NextRequest('http://localhost/api/groups/step-down', { method: 'POST', headers: cookieIn('bpm'), body: JSON.stringify({ to }) }));

  it('to member: the rollback copy drops', async () => {
    linAdminIn('bpm'); // someone to pass the club to
    expect((await stepDown('member')).status).toBe(200);
    expect(roleOf(ADMIN_MEMBER_ID)).toBe('member');
  });

  it('to admin: the copy stays admin', async () => {
    linAdminIn('bpm');
    expect((await stepDown('admin')).status).toBe(200);
    expect(roleOf(ADMIN_MEMBER_ID)).toBe('admin');
  });
});

describe('the operator’s override', () => {
  it('lowering a BPM admin drops the rollback copy', async () => {
    const lin = linAdminIn('bpm');
    const res = await override(new NextRequest('http://localhost/api/operator/membership', {
      method: 'POST',
      headers: { ...cookieIn('bpm'), 'x-migration-key': KEY },
      body: JSON.stringify({ groupId: 'bpm', memberId: lin.id, role: 'member' }),
    }));
    expect(res.status).toBe(200);
    expect(roleOf(lin.id)).toBe('member');
  });
});

describe('stale copies, and a failure while dropping one', () => {
  it('the migration counts admin copies BPM’s list no longer backs, and its run drops them', async () => {
    const { backfillStatus, runBackfill } = await import('../lib/groupBackfill');
    // Demoted before this change: the membership says member, the copy admin.
    const lin = seedMember('Lin', { id: 'm-lin', role: 'admin' });
    seedMembership('bpm', lin.id, { name: 'Lin', role: 'member' });
    // Still BPM's admin: left alone.
    const kento = seedMember('Kento', { id: 'm-kento', role: 'admin' });
    seedMembership('bpm', kento.id, { name: 'Kento', role: 'admin' });

    expect((await backfillStatus()).members.staleAdminCopies).toBe(1);
    const dry = await runBackfill({ dryRun: true });
    expect(dry.memberships.rankCopiesDropped).toBe(1);
    expect(roleOf(lin.id)).toBe('admin'); // a dry run writes nothing

    const run = await runBackfill({ dryRun: false });
    expect(run.memberships.rankCopiesDropped).toBe(1);
    expect(roleOf(lin.id)).toBe('member');
    expect(roleOf(kento.id)).toBe('admin');
    expect(roleOf(ADMIN_MEMBER_ID)).toBe('admin'); // BPM's organiser
    expect((await backfillStatus()).members.staleAdminCopies).toBe(0);
  });

  it('followRankDown never throws: the rank change it follows has already happened', async () => {
    vi.resetModules();
    vi.doMock('../lib/cosmos', async (orig) => ({
      ...(await orig<typeof import('../lib/cosmos')>()),
      getContainer: () => ({ item: () => ({ read: async () => { throw Object.assign(new Error('Cosmos 503'), { code: 503 }); } }) }),
    }));
    const { followRankDown } = await import('../lib/rollbackRank');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(followRankDown('bpm', 'm-lin', 'member')).resolves.toBeUndefined();
    expect(logged.mock.calls.some((c) => String(c[0]).includes('[rollback-rank]'))).toBe(true);
    logged.mockRestore();
    vi.doUnmock('../lib/cosmos');
    vi.resetModules();
  });
});
