import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeRequest, memberCookieValue, resetMockStore, seedDoc, seedGroup, seedMember, seedMembership, seedPlayer, setupAdminPin } from './helpers';
import { GET } from '@/app/api/members/me/payments/route';
import { foldPayments, lastMonths, monthOf } from '@/lib/memberPayments';
import type { Player, Session, StringingJob } from '@/lib/types';

/**
 * What a member has PAID, month by month (Profile → Account balance, spec §4):
 * built from the rows, always the caller's own, and only in the club their
 * cookie names — one person on two rosters sees two separate histories.
 */

describe('monthOf / lastMonths', () => {
  it('reads the month in Vancouver time', () => {
    // 2026-12-01T05:00Z is still November 30 in Vancouver.
    expect(monthOf('2026-12-01T05:00:00.000Z')).toBe('2026-11');
    expect(monthOf('nope')).toBeNull();
    expect(monthOf(null)).toBeNull();
  });
  it('lists the window oldest first, across a year end', () => {
    expect(lastMonths(3, new Date('2026-02-10T20:00:00Z'))).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('foldPayments', () => {
  const window = ['2026-10', '2026-11'];
  const session = (id: string, datetime: string) => ({ id, sessionId: id, datetime }) as unknown as Session;
  const sessions = new Map([
    ['s1', session('s1', '2026-10-08T19:00:00-07:00')],
    ['s2', session('s2', '2026-11-05T19:00:00-08:00')],
  ]);
  const row = (o: Partial<Player>) => ({ id: Math.random().toString(36), name: 'Lin', sessionId: 's1', ...o }) as Player;

  it('puts each paid row in the month it was paid, by kind', () => {
    const players = [
      row({ paid: true, owedAmount: 12.5, paidAt: '2026-10-09T03:00:00Z' }),
      row({ sessionId: 's2', paid: true, owedAmount: 12, paidAt: '2026-11-06T20:00:00Z' }),
      row({ sessionId: 's2', paid: true, owedAmount: 10, paidAt: '2026-11-06T20:00:00Z', guestOf: 'm1', guestName: 'Jenny' }),
      // Not paid, or paid with no frozen figure: nothing to add.
      row({ sessionId: 's2', paid: false, owedAmount: 12 }),
      row({ sessionId: 's2', paid: true }),
    ];
    const jobs = [
      { id: 'j1', memberId: 'm1', priceCents: 2800, paidAt: '2026-11-02T18:00:00Z' },
      { id: 'j2', memberId: 'm1', priceCents: 3000, paidAt: null },
    ] as unknown as StringingJob[];
    const out = foldPayments({ players, sessionById: sessions, jobs, memberId: 'm1' }, window);
    expect(out).toEqual([
      { month: '2026-10', sessions: 1250, stringing: 0, other: 0, nights: 1, guests: [] },
      { month: '2026-11', sessions: 1200, stringing: 2800, other: 1000, nights: 1, guests: [{ name: 'Jenny', date: '2026-11-05T19:00:00-08:00' }] },
    ]);
  });

  it('falls back to the settle date, then the session date, for rows marked before paidAt existed', () => {
    const players = [
      row({ paid: true, owedAmount: 10, settledAt: '2026-11-01T20:00:00Z' }),
      row({ sessionId: 's1', paid: true, owedAmount: 7 }),
    ];
    const out = foldPayments({ players, sessionById: sessions, jobs: [], memberId: 'm1' }, window);
    expect(out.map((m) => m.sessions)).toEqual([700, 1000]);
  });

  it('keeps every month in the window and drops what falls outside it', () => {
    const players = [row({ paid: true, owedAmount: 10, paidAt: '2025-01-01T20:00:00Z' })];
    const out = foldPayments({ players, sessionById: sessions, jobs: [], memberId: 'm1' }, window);
    expect(out.map((m) => m.month)).toEqual(window);
    expect(out.every((m) => m.sessions === 0)).toBe(true);
  });
});

describe('GET /api/members/me/payments', () => {
  const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
  const STRINGING = 'NEXT_PUBLIC_FLAG_STRINGING';
  const before = { [FLAG]: process.env[FLAG], [STRINGING]: process.env[STRINGING] };
  let lin: { id: string };
  let ip = 0;
  const now = new Date().toISOString();
  const thisMonth = monthOf(now);

  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env[FLAG] = 'true';
    process.env[STRINGING] = 'true';
    seedGroup('bpm', { ownerMemberId: 'grant', name: 'BPM Core' });
    seedGroup('club-x', { ownerMemberId: 'owner-x', name: 'Six Feathers' });
    lin = seedMember('Lin');
    // One person on both rosters: only the club can tell their rows apart.
    seedMembership('bpm', lin.id, { name: 'Lin' });
    seedMembership('club-x', lin.id, { name: 'Lin' });
    seedDoc('sessions', { id: 'session-2026-11-05', sessionId: 'session-2026-11-05', groupId: 'bpm', datetime: now });
    seedDoc('sessions', { id: 'club-x:session-2026-11-07', sessionId: 'club-x:session-2026-11-07', groupId: 'club-x', datetime: now });
    seedPlayer('session-2026-11-05', 'Lin', { memberId: lin.id, groupId: 'bpm', paid: true, owedAmount: 12, paidAt: now });
    seedPlayer('session-2026-11-05', 'Jenny (Lin)', { guestOf: lin.id, guestName: 'Jenny', groupId: 'bpm', paid: true, owedAmount: 10, paidAt: now });
    seedPlayer('club-x:session-2026-11-07', 'Lin', { memberId: lin.id, groupId: 'club-x', paid: true, owedAmount: 40, paidAt: now });
    seedDoc('stringingJobs', { id: 'job-1', memberId: lin.id, groupId: 'bpm', priceCents: 2800, paidAt: now, status: 'picked_up' });
    seedDoc('stringingJobs', { id: 'job-2', memberId: lin.id, groupId: 'club-x', priceCents: 9900, paidAt: now, status: 'picked_up' });
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const ask = (groupId: string | null, query = '') =>
    GET(
      makeRequest('GET', `http://x/api/members/me/payments${query}`, undefined, {
        'X-Client-IP': `10.88.0.${ip++ % 250}`,
        ...(groupId ? { Cookie: `member_session=${memberCookieValue('Lin', lin.id, undefined, groupId)}` } : {}),
      }),
    );

  it('answers six months of the caller’s own payments in the club their cookie names', async () => {
    const res = await ask('bpm');
    expect(res.status).toBe(200);
    const { months } = (await res.json()) as { months: Array<Record<string, unknown>> };
    expect(months).toHaveLength(6);
    expect(months[5]).toEqual({
      month: thisMonth,
      sessions: 1200,
      stringing: 2800,
      other: 1000,
      nights: 1,
      guests: [{ name: 'Jenny', date: now }],
    });
  });

  it('the other club’s rows stay in the other club', async () => {
    const res = await ask('club-x');
    const { months } = (await res.json()) as { months: Array<Record<string, unknown>> };
    expect(months[5]).toMatchObject({ month: thisMonth, sessions: 4000, stringing: 9900, other: 0 });
  });

  it('honours a shorter window and caps a long one', async () => {
    expect(((await (await ask('bpm', '?months=3')).json()) as { months: unknown[] }).months).toHaveLength(3);
    expect(((await (await ask('bpm', '?months=99')).json()) as { months: unknown[] }).months).toHaveLength(12);
  });

  it('refuses a caller with no member cookie', async () => {
    expect((await ask(null)).status).toBe(401);
  });
});
