import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  seedTestAdminMember,
  makeAdminRequest,
  memberCookieValue,
  getStore,
} from './helpers';
import { POST as ADVANCE } from '@/app/api/session/advance/route';
import { POST, PATCH } from '@/app/api/players/route';

/**
 * A SETTLED session is frozen money. Settle stamps `owedAmount` on the rows it
 * finds, so anything that adds a row afterwards — a sign-up, an admin add, a
 * promotion off the waitlist, a restore of a row removed before settle —
 * creates a player who owes nothing: off the balance card, the reminders, the
 * hold, the reconcile and the ledger. And re-advancing to an archived date
 * replaced its doc outright, dropping `settled` while the rows kept their
 * frozen amounts. Every one of those writes is refused now (code review,
 * 2026-10-21); the one row that may come back is a cancelled one that was
 * stamped before it left.
 */
const SID = 'session-2026-10-08';
const URL = 'http://localhost:3000/api/players';
const settled = { at: '2026-10-09T05:00:00.000Z', costPerPerson: 15, totalCost: 120, courtTotal: 120, birdTotal: 0, playerCount: 8, playerNames: [] };

const rows = () => getStore()['players'] as Array<Record<string, unknown>>;
let n = 0;
function memberPost(name: string, body: Record<string, unknown> = {}) {
  const member = seedMember(name);
  return new NextRequest(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-IP': `settled-${++n}`, Cookie: `member_session=${memberCookieValue(name, member.id)}` },
    body: JSON.stringify({ name, ...body }),
  });
}

describe('writes onto a settled session', () => {
  beforeEach(async () => {
    setupAdminPin();
    resetMockStore();
    await seedTestAdminMember();
    seedPointer(SID);
    seedSession(SID, { costPerCourt: 60, courts: 2, settled, signupOpen: true });
  });

  it('a member cannot sign up onto it', async () => {
    const res = await POST(memberPost('Lin'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('session_settled');
    expect(rows() ?? []).toHaveLength(0);
  });

  it('an admin cannot add a new name onto it either', async () => {
    const res = await POST(makeAdminRequest('POST', URL, { name: 'Late Larry' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('session_settled');
  });

  it('a cancelled row that was stamped before it left comes back with its bill', async () => {
    seedPlayer(SID, 'Lin', { removed: true, removedAt: '2026-10-09T06:00:00.000Z', owedAmount: 15, settledAt: settled.at });
    const res = await POST(makeAdminRequest('POST', URL, { name: 'Lin' }));
    expect(res.status).toBe(201);
    const row = rows().find((p) => p.name === 'Lin')!;
    expect(row.removed).toBe(false);
    expect(row.owedAmount).toBe(15);
    expect(row.settledAt).toBe(settled.at);
  });

  it('a row removed BEFORE settle (no bill on it) does not come back', async () => {
    seedPlayer(SID, 'Lin', { removed: true, removedAt: '2026-10-08T06:00:00.000Z' });
    const res = await POST(makeAdminRequest('POST', URL, { name: 'Lin' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('session_settled');
  });

  it('PATCH cannot promote a waitlisted row (it was never stamped)', async () => {
    const p = seedPlayer(SID, 'Wai', { waitlisted: true });
    const res = await PATCH(makeAdminRequest('PATCH', URL, { id: p.id, waitlisted: false }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('session_settled');
    expect(rows().find((r) => r.id === p.id)!.waitlisted).toBe(true);
  });

  it('PATCH restores a removed row only when it carries its bill', async () => {
    const stamped = seedPlayer(SID, 'Lin', { removed: true, owedAmount: 15, settledAt: settled.at });
    const bare = seedPlayer(SID, 'Bo', { removed: true });
    const ok = await PATCH(makeAdminRequest('PATCH', URL, { id: stamped.id, removed: false }));
    expect(ok.status).toBe(200);
    expect(rows().find((r) => r.id === stamped.id)!.removed).toBe(false);
    const refused = await PATCH(makeAdminRequest('PATCH', URL, { id: bare.id, removed: false }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe('session_settled');
  });

  it('paid, cover and other edits on a settled session still work', async () => {
    const p = seedPlayer(SID, 'Lin', { owedAmount: 15, settledAt: settled.at });
    const res = await PATCH(makeAdminRequest('PATCH', URL, { id: p.id, paid: true }));
    expect(res.status).toBe(200);
    expect(rows().find((r) => r.id === p.id)!.paid).toBe(true);
  });
});

describe('POST /api/session/advance onto a date that already exists', () => {
  beforeEach(async () => {
    setupAdminPin();
    resetMockStore();
    await seedTestAdminMember();
    seedPointer('session-2026-10-15');
    seedSession('session-2026-10-15', { title: 'This week' });
    seedSession(SID, { title: 'Last week', costPerCourt: 60, courts: 2, settled });
  });

  it('refuses with 409 and leaves the archived doc, settled snapshot included, untouched', async () => {
    const res = await ADVANCE(makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', { datetime: '2026-10-08T19:00:00-07:00' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'session_exists', sessionId: SID });
    const doc = (getStore()['sessions'] as Array<Record<string, unknown>>).find((s) => s.id === SID)!;
    expect(doc.settled).toEqual(settled);
    expect(doc.title).toBe('Last week');
    const pointer = (getStore()['sessions'] as Array<Record<string, unknown>>).find((s) => s.id === 'active-session-pointer') as { activeSessionId?: string } | undefined;
    expect(pointer?.activeSessionId ?? 'session-2026-10-15').toBe('session-2026-10-15');
  });
});
